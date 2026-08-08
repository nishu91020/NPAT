import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient, RestError } from '@azure/storage-blob';
import { BonusChallenge } from '../../src/types';
import { DailyChallengeStore } from './store';

const CONTAINER = 'daily-challenges';

/** One blob per date, so a day's challenge is trivially inspectable. */
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

/**
 * Blob-backed store.
 *
 * Production authenticates with Entra ID, so there is no connection string and
 * no key — the identity needs the *Storage Blob Data Contributor* role. Local
 * development points at Azurite with the well-known development connection
 * string, which is a fixed test credential and not a secret.
 */
export function createBlobStore(
  endpointOrConnectionString: string,
  containerName = CONTAINER
): DailyChallengeStore {
  const service = endpointOrConnectionString.includes('AccountKey=') ||
    endpointOrConnectionString === 'UseDevelopmentStorage=true'
    ? BlobServiceClient.fromConnectionString(endpointOrConnectionString)
    : new BlobServiceClient(endpointOrConnectionString, new DefaultAzureCredential());

  const container = service.getContainerClient(containerName);
  let ensured: Promise<unknown> | null = null;

  /** Created on first use so local development needs no setup step. */
  function ensureContainer() {
    ensured ??= container.createIfNotExists().catch((err) => {
      // A parallel replica may have created it first, which is fine.
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
        // '*' means "only if this blob does not exist", so the first replica to
        // arrive wins and the rest read its value instead of overwriting it.
        await container.getBlockBlobClient(blobName(dateStr)).upload(body, Buffer.byteLength(body), {
          blobHTTPHeaders: { blobContentType: 'application/json' },
          conditions: { ifNoneMatch: '*' },
        });

        return challenge;
      } catch (err) {
        if (err instanceof RestError && (err.statusCode === 409 || err.statusCode === 412)) {
          // Someone else stored one first; theirs is the one everybody serves.
          return (await get(dateStr)) ?? challenge;
        }
        throw err;
      }
    },
  };
}
