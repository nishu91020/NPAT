import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient, RestError } from '@azure/storage-blob';
import { BonusChallenge } from '../../shared/contract';
import { DailyChallengeStore } from './dailyChallenge';

const CONTAINER = 'daily-challenges';

function blobName(dateStr: string): string {
  return `${dateStr}.json`;
}

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createBlobStore(
  endpointOrConnectionString: string,
  containerName = CONTAINER
): DailyChallengeStore {
  const service = endpointOrConnectionString.includes('AccountKey=') ||
    endpointOrConnectionString === 'UseDevelopmentStorage=true'
    ? BlobServiceClient.fromConnectionString(endpointOrConnectionString)
    : new BlobServiceClient(endpointOrConnectionString, new DefaultAzureCredential());

  const container = service.getContainerClient(containerName);
  let ensured: Promise<Awaited<ReturnType<typeof container.createIfNotExists>>> | null = null;

  function ensureContainer() {
    ensured ??= container.createIfNotExists().catch((err) => {

      ensured = null;
      throw err;
    });
    return ensured;
  }

  async function get(dateStr: string): Promise<BonusChallenge | null> {
    try {
      const response = await container.getBlockBlobClient(blobName(dateStr)).download();
      if (!response.readableStreamBody) return null;

      return JSON.parse(await readAll(response.readableStreamBody)) as BonusChallenge;
    } catch (err) {
      if (err instanceof RestError && (err.statusCode === 404 || err.statusCode === 403)) {
        return null;
      }
      throw err;
    }
  }

  return {
    get,

    async put(dateStr, challenge) {
      await ensureContainer();
      const body = JSON.stringify(challenge);

      await container.getBlockBlobClient(blobName(dateStr)).upload(body, Buffer.byteLength(body), {
        blobHTTPHeaders: { blobContentType: 'application/json' },
      });
    },

    async putIfAbsent(dateStr, challenge) {
      await ensureContainer();
      const body = JSON.stringify(challenge);

      try {

        await container.getBlockBlobClient(blobName(dateStr)).upload(body, Buffer.byteLength(body), {
          blobHTTPHeaders: { blobContentType: 'application/json' },
          conditions: { ifNoneMatch: '*' },
        });

        return challenge;
      } catch (err) {
        if (err instanceof RestError && (err.statusCode === 409 || err.statusCode === 412)) {

          return (await get(dateStr)) ?? challenge;
        }
        throw err;
      }
    },
  };
}
