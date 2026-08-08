<#
.SYNOPSIS
    Builds and deploys Letters Daily to Azure Container Apps.

.DESCRIPTION
    Builds the image in Azure Container Registry (no local Docker needed), then
    points the container app at the new tag and verifies it is actually serving.

    Safe to re-run. It changes only the image tag unless -Provision is given.

.PARAMETER Provision
    Create the resource group, storage, environment, app, identity, roles and
    budget if they do not exist. Needed for a first deployment only.

.PARAMETER SkipVerify
    Skip the post-deploy checks. Not recommended.

.PARAMETER Tag
    Image tag to deploy. Defaults to a timestamp. Pass an existing tag to roll
    back without rebuilding.

.EXAMPLE
    .\scripts\deploy.ps1
    Build the current working tree and deploy it.

.EXAMPLE
    .\scripts\deploy.ps1 -Tag v20260808205540
    Roll back to an image that was already built.

.EXAMPLE
    .\scripts\deploy.ps1 -Provision
    First-time setup, then deploy.
#>

[CmdletBinding()]
param(
    [switch]$Provision,
    [switch]$SkipVerify,
    [string]$Tag = "v$(Get-Date -Format yyyyMMddHHmmss)",

    [string]$ResourceGroup = 'rg-lettersdaily',
    [string]$Location      = 'eastus2',
    [string]$AppName       = 'ca-lettersdaily',
    [string]$Environment   = 'cae-lettersdaily',
    [string]$Registry      = 'ca9bc930aa10acr',
    [string]$InsightsName  = 'appi-lettersdaily',

    # The Foundry resource lives in its own resource group.
    [string]$FoundryName   = 'ms151-mdvwh1hi-eastus2',
    [string]$FoundryGroup  = 'rg-ms1514094-0019_ai',
    [string]$JudgeDeployment = 'gpt-4.1-mini',
    [string]$BonusDeployment = 'gpt-4.1-mini',

    [int]$MinReplicas  = 0,
    [int]$MaxReplicas  = 5,
    [int]$BudgetAmount = 10
)

$ErrorActionPreference = 'Stop'

# The az CLI is a Python application, and it dies with UnicodeEncodeError when
# it prints a tick character to a cp1252 console - which it does while streaming
# ACR build logs. Forcing UTF-8 stops a successful build from looking like a
# failure.
$env:PYTHONIOENCODING = 'utf-8'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# ------------------------------- helpers --------------------------------

function Write-Step { param($m) Write-Host "`n> $m" -ForegroundColor Cyan }
function Write-Ok   { param($m) Write-Host "  [ok] $m" -ForegroundColor Green }
function Write-Info { param($m) Write-Host "  .  $m" -ForegroundColor DarkGray }
function Write-Warn2{ param($m) Write-Host "  !  $m" -ForegroundColor Yellow }
function Fail       { param($m) Write-Host "`n[X] $m" -ForegroundColor Red; exit 1 }

<#
    Resolves the az CLI.

    A shell opened before the CLI was installed will not have it on PATH, so
    fall back to the known install locations rather than failing confusingly.
#>
function Resolve-Az {
    $cmd = Get-Command az -ErrorAction SilentlyContinue
    if ($cmd) { return 'az' }

    $candidates = @(
        "$env:ProgramFiles\Microsoft SDKs\Azure\CLI2\wbin\az.cmd",
        "${env:ProgramFiles(x86)}\Microsoft SDKs\Azure\CLI2\wbin\az.cmd",
        "$env:LOCALAPPDATA\Programs\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
    )
    foreach ($c in $candidates) { if (Test-Path $c) { return $c } }

    Fail 'Azure CLI not found. Install it from https://aka.ms/installazurecli, then re-run.'
}

$AZ = Resolve-Az

function Invoke-Az {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

    $output = & $AZ @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "az $($Arguments -join ' ') failed:`n$(($output | Out-String).Trim())"
    }
    return $output
}

# Output flags are appended to the argument array rather than passed to these
# functions. PowerShell would otherwise bind `-o` to its own common parameters
# and fail with "the parameter name 'o' is ambiguous".
function Invoke-AzJson {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

    $text = ((Invoke-Az @($Arguments + @('-o', 'json'))) | Out-String).Trim()
    if (-not $text) { return $null }

    # The containerapp extension prints "WARNING: The behavior of this command
    # has been altered..." to the same stream as the payload, so trim anything
    # before the first JSON token rather than handing it all to the parser.
    $start = $text.IndexOfAny([char[]]@('{', '['))
    if ($start -lt 0) { return $null }

    return $text.Substring($start) | ConvertFrom-Json
}

function Get-AzValue {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

    $text = ((Invoke-Az @($Arguments + @('-o', 'tsv'))) | Out-String).Trim()

    # Same warning problem, but tsv has no delimiter to anchor on, so drop any
    # leading WARNING lines instead.
    $lines = @($text -split "`r?`n" | Where-Object { $_ -notmatch '^\s*(WARNING|Command group)' })
    return ($lines -join "`n").Trim()
}

# ------------------------------ preflight -------------------------------

Write-Step 'Checking prerequisites'

$account = $null
try { $account = Invoke-AzJson account show } catch { }
if (-not $account) { Fail "Not signed in. Run 'az login' and try again." }

Write-Ok "Subscription: $($account.name)"
Write-Info "Signed in as $($account.user.name)"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not (Test-Path (Join-Path $repoRoot 'Dockerfile'))) {
    Fail "Dockerfile not found at $repoRoot. Run this from the repository."
}

$extensions = Invoke-AzJson extension list --query "[].name"
if ($extensions -notcontains 'containerapp') {
    Write-Info 'Installing the containerapp CLI extension'
    Invoke-Az extension add --name containerapp --only-show-errors | Out-Null
}
Write-Ok 'containerapp extension present'

# ---------------------------- provisioning ------------------------------

if ($Provision) {
    Write-Step 'Provisioning infrastructure (idempotent)'

    Invoke-Az group create -n $ResourceGroup -l $Location --only-show-errors | Out-Null
    Write-Ok "Resource group $ResourceGroup"

    # Storage account names are globally unique and lowercase alphanumeric, so
    # reuse an existing one rather than inventing a new name on every run.
    $existingStorage = @(Invoke-AzJson storage account list -g $ResourceGroup --query "[?starts_with(name,'stlettersdaily')].name")
    if ($existingStorage.Count -gt 0) {
        $storageName = $existingStorage[0]
        Write-Ok "Storage account $storageName (existing)"
    }
    else {
        $storageName = 'stlettersdaily' + (Get-Random -Minimum 10000 -Maximum 99999)
        Invoke-Az storage account create -n $storageName -g $ResourceGroup -l $Location `
            --sku Standard_LRS --kind StorageV2 `
            --min-tls-version TLS1_2 --allow-blob-public-access false `
            --only-show-errors | Out-Null
        Write-Ok "Storage account $storageName (created)"
    }

    $envExists = @(Invoke-AzJson containerapp env list -g $ResourceGroup --query "[?name=='$Environment'].name")
    if ($envExists.Count -eq 0) {
        Write-Info 'Creating the Container Apps environment (takes a few minutes)'
        Invoke-Az containerapp env create -n $Environment -g $ResourceGroup -l $Location --only-show-errors | Out-Null
    }
    Write-Ok "Container Apps environment $Environment"

    $acrExists = @(Invoke-AzJson acr list -g $ResourceGroup --query "[?name=='$Registry'].name")
    if ($acrExists.Count -eq 0) {
        Invoke-Az acr create -n $Registry -g $ResourceGroup -l $Location --sku Basic --only-show-errors | Out-Null
    }
    Write-Ok "Registry $Registry"

    # Application Insights, on the workspace the environment already created.
    $aiExists = $null
    try { $aiExists = Get-AzValue monitor app-insights component show --app $InsightsName -g $ResourceGroup --query name } catch { }
    if (-not $aiExists) {
        $workspace = Get-AzValue monitor log-analytics workspace list -g $ResourceGroup --query "[0].id"
        Invoke-Az monitor app-insights component create --app $InsightsName -g $ResourceGroup -l $Location `
            --workspace $workspace --application-type web --only-show-errors | Out-Null
    }
    Write-Ok "Application Insights $InsightsName"
}

# -------------------------------- build ---------------------------------

# An existing tag is a rollback, so skip the build entirely and go straight to
# deploying it.
$existingTags = @()
try { $existingTags = @(Invoke-AzJson acr repository show-tags -n $Registry --repository $AppName) } catch { }

if ($existingTags -contains $Tag) {
    Write-Step "Reusing existing image $Tag"
    Write-Info 'Tag already in the registry, so nothing is rebuilt'
    Write-Ok "Image $($AppName):$Tag"
}
else {
    Write-Step "Building image $Tag"
    Write-Info 'Built in Azure, so no local Docker is required'

    Push-Location $repoRoot
    try {
        # The CLI can still die while printing build logs even with
        # PYTHONIOENCODING set, while the cloud build carries on regardless - so
        # a non-zero exit here is not trusted. The tag check below is the real
        # verdict.
        & $AZ acr build -r $Registry -t "$($AppName):$Tag" . --only-show-errors 2>&1 | Out-Null
    }
    catch {
        Write-Warn2 'The CLI errored while streaming build logs; verifying the build itself'
    }
    finally {
        Pop-Location
    }

    Write-Step 'Confirming the build produced an image'

    $status = 'Unknown'
    $deadline = (Get-Date).AddMinutes(20)
    do {
        $status = Get-AzValue acr task list-runs -r $Registry --top 1 --query "[0].status"
        if ($status -notin @('Running', 'Queued', 'Started')) { break }
        Write-Info "build $status..."
        Start-Sleep -Seconds 15
    } while ((Get-Date) -lt $deadline)

    if ($status -ne 'Succeeded') { Fail "Image build did not succeed (status: $status)." }

    $tags = @(Invoke-AzJson acr repository show-tags -n $Registry --repository $AppName)
    if ($tags -notcontains $Tag) { Fail "Build reported success but tag '$Tag' is not in the registry." }

    Write-Ok "Image $($AppName):$Tag"
}

# -------------------------------- deploy --------------------------------

$image = "$Registry.azurecr.io/$($AppName):$Tag"
$appExists = @(Invoke-AzJson containerapp list -g $ResourceGroup --query "[?name=='$AppName'].name")

if ($appExists.Count -eq 0) {
    if (-not $Provision) {
        Fail "Container app '$AppName' does not exist. Re-run with -Provision to create it."
    }

    Write-Step 'Creating the container app'

    $storageName = @(Invoke-AzJson storage account list -g $ResourceGroup --query "[?starts_with(name,'stlettersdaily')].name")[0]
    $foundryEndpoint = "https://$FoundryName.services.ai.azure.com/openai/v1"
    $insightsCs = Get-AzValue monitor app-insights component show --app $InsightsName -g $ResourceGroup --query connectionString

    Invoke-Az containerapp create -n $AppName -g $ResourceGroup --environment $Environment `
        --image $image --registry-server "$Registry.azurecr.io" --registry-identity system `
        --system-assigned `
        --ingress external --target-port 3000 `
        --min-replicas $MinReplicas --max-replicas $MaxReplicas `
        --cpu 0.5 --memory 1.0Gi `
        --env-vars `
            "AZURE_OPENAI_ENDPOINT=$foundryEndpoint" `
            "AZURE_OPENAI_JUDGE_DEPLOYMENT=$JudgeDeployment" `
            "AZURE_OPENAI_BONUS_DEPLOYMENT=$BonusDeployment" `
            "DAILY_CHALLENGE_STORAGE=https://$storageName.blob.core.windows.net" `
            "APPLICATIONINSIGHTS_CONNECTION_STRING=$insightsCs" `
        --only-show-errors | Out-Null

    Write-Ok 'Container app created'
}
else {
    Write-Step 'Updating the container app'
    Invoke-Az containerapp update -n $AppName -g $ResourceGroup --image $image --only-show-errors | Out-Null
    Write-Ok 'Image updated'
}

# -------------------------- identity and roles --------------------------

if ($Provision) {
    Write-Step 'Assigning roles to the managed identity'

    $principalId = Get-AzValue containerapp show -n $AppName -g $ResourceGroup --query identity.principalId
    if (-not $principalId) { Fail 'The container app has no system-assigned identity.' }
    Write-Info "Identity $principalId"

    $subId = $account.id
    $storageName = @(Invoke-AzJson storage account list -g $ResourceGroup --query "[?starts_with(name,'stlettersdaily')].name")[0]

    # Scoped to one resource each: inference on Foundry, blob data on storage,
    # pull on the registry. Nothing wider.
    $assignments = @(
        @{ Role  = 'Cognitive Services OpenAI User'
           Scope = "/subscriptions/$subId/resourceGroups/$FoundryGroup/providers/Microsoft.CognitiveServices/accounts/$FoundryName" },
        @{ Role  = 'Storage Blob Data Contributor'
           Scope = "/subscriptions/$subId/resourceGroups/$ResourceGroup/providers/Microsoft.Storage/storageAccounts/$storageName" },
        @{ Role  = 'AcrPull'
           Scope = "/subscriptions/$subId/resourceGroups/$ResourceGroup/providers/Microsoft.ContainerRegistry/registries/$Registry" }
    )

    foreach ($a in $assignments) {
        $existing = @(Invoke-AzJson role assignment list --assignee $principalId --scope $a.Scope --query "[?roleDefinitionName=='$($a.Role)'].id")
        if ($existing.Count -gt 0) {
            Write-Ok "$($a.Role) (already assigned)"
            continue
        }

        Invoke-Az role assignment create --assignee-object-id $principalId --assignee-principal-type ServicePrincipal `
            --role $a.Role --scope $a.Scope --only-show-errors | Out-Null
        Write-Ok "$($a.Role) (assigned)"
    }

    # Budget. Created through the REST API because
    # `az consumption budget create` rejects a resource-group scope.
    Write-Step 'Ensuring a budget guardrail'

    $budgetUri = "/subscriptions/$subId/resourceGroups/$ResourceGroup/providers/Microsoft.Consumption/budgets/budget-$AppName" +
                 '?api-version=2021-10-01'
    $existingBudget = $null
    try { $existingBudget = Invoke-AzJson rest --method get --uri $budgetUri } catch { }

    if ($existingBudget) {
        Write-Ok "Budget exists (`$$($existingBudget.properties.amount)/month)"
    }
    else {
        $body = @{
            properties = @{
                category   = 'Cost'
                amount     = $BudgetAmount
                timeGrain  = 'Monthly'
                timePeriod = @{
                    startDate = (Get-Date -Format 'yyyy-MM-01') + 'T00:00:00Z'
                    endDate   = (Get-Date -Day 1).AddYears(2).ToString('yyyy-MM-01') + 'T00:00:00Z'
                }
                notifications = @{
                    Actual80 = @{
                        enabled = $true; operator = 'GreaterThan'; threshold = 80
                        contactEmails = @($account.user.name); thresholdType = 'Actual'
                    }
                    Forecast100 = @{
                        enabled = $true; operator = 'GreaterThan'; threshold = 100
                        contactEmails = @($account.user.name); thresholdType = 'Forecasted'
                    }
                }
            }
        } | ConvertTo-Json -Depth 8 -Compress

        $bodyFile = Join-Path ([System.IO.Path]::GetTempPath()) "budget-$([guid]::NewGuid()).json"
        Set-Content -Path $bodyFile -Value $body -Encoding utf8
        try {
            Invoke-Az rest --method put --uri $budgetUri --body "@$bodyFile" --only-show-errors | Out-Null
            Write-Ok "Budget created (`$$BudgetAmount/month, alerts at 80% actual and 100% forecast)"
        }
        finally {
            Remove-Item $bodyFile -Force -ErrorAction SilentlyContinue
        }
    }
}

# -------------------------------- verify --------------------------------

$fqdn = Get-AzValue containerapp show -n $AppName -g $ResourceGroup --query 'properties.configuration.ingress.fqdn'
$url  = "https://$fqdn"

if ($SkipVerify) {
    Write-Step 'Skipping verification'
    Write-Host "`nDeployed: $url" -ForegroundColor Green
    exit 0
}

Write-Step 'Verifying the deployment'

# The app scales to zero, so the first request pays a cold start.
$health = $null
foreach ($attempt in 1..5) {
    try {
        $health = Invoke-RestMethod "$url/api/health" -TimeoutSec 60
        break
    }
    catch {
        Write-Info "health check attempt $attempt failed, retrying..."
        Start-Sleep -Seconds 10
    }
}
if (-not $health) { Fail "Health check never succeeded at $url/api/health" }
Write-Ok "Healthy ($($health.status))"

try {
    $index = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 60
    if ($index.Content -notmatch 'id="root"') { throw 'index.html did not contain the app root' }
    Write-Ok 'SPA served'
}
catch {
    Fail "The SPA is not being served: $_"
}

# A real round, which exercises Foundry over managed identity end to end.
$round = @{
    letter  = 'S'
    answers = @{ name = 'Sarah'; place = 'Spain'; animal = 'Shark'; thing = 'Spoon' }
    bonusChallenge = @{
        id = 'long_words'; title = 'Super Size Words'
        description = 'All 4 answers must be at least 5 letters long.'
        icon = 'Sparkles'; ruleHint = '5+ letters'
    }
    timeTakenSeconds = 18
} | ConvertTo-Json -Depth 6 -Compress

try {
    $result = Invoke-RestMethod "$url/api/validate" -Method Post -ContentType 'application/json' -Body $round -TimeoutSec 120
    Write-Ok "Round scored $($result.totalScore), judged by '$($result.judgedBy)'"

    if ($result.judgedBy -ne 'azure') {
        Write-Warn2 "Expected the AI judge but got '$($result.judgedBy)'."
        Write-Warn2 'The game still works, but Foundry is unreachable - check the role assignment and the endpoint.'
    }
}
catch {
    Fail "A round could not be scored: $_"
}

try {
    $daily = Invoke-RestMethod "$url/api/daily-challenge" -TimeoutSec 120
    Write-Ok "Daily challenge: '$($daily.bonusChallenge.title)' for letter $($daily.letter)"
}
catch {
    Write-Warn2 "The daily challenge endpoint failed: $_"
}

$revision = Get-AzValue containerapp show -n $AppName -g $ResourceGroup --query 'properties.latestRevisionName'

Write-Host "`n$('-' * 62)" -ForegroundColor DarkGray
Write-Host "Deployed  $url" -ForegroundColor Green
Write-Host "Revision  $revision" -ForegroundColor DarkGray
Write-Host "Image     $Tag" -ForegroundColor DarkGray
Write-Host "Rollback  .\scripts\deploy.ps1 -Tag <previous-tag>" -ForegroundColor DarkGray
Write-Host "$('-' * 62)`n" -ForegroundColor DarkGray
