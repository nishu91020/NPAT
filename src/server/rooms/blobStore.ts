import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient, RestError } from '@azure/storage-blob';
import { RoomVersionConflict, type Room, type RoomStore, type StoredRoom } from './types';

const CONTAINER = 'rooms';

/** One blob per room, so a room is trivially inspectable while it is live. */
function blobName(code: string): string {
  return `${code}.json`;
}

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** 409 and 412 both mean the same thing here: someone else wrote first. */
function isConflict(err: unknown): boolean {
  return err instanceof RestError && (err.statusCode === 409 || err.statusCode === 412);
}

/**
 * Blob-backed rooms — the adapter that makes a room survive more than one replica.
 *
 * The whole room is one JSON blob, and every write is conditional on the ETag the
 * reader saw. That is what the research settled on: the storage account is already
 * deployed and already reachable by the app's identity, a room is kilobytes, and
 * ETag compare-and-swap gives the read-modify-write safety a room needs. Keeping
 * the room in ONE blob is load-bearing — separate blobs per player could not be
 * updated together, and "record this submission and end the round" has to be one
 * indivisible step.
 *
 * Production authenticates with Entra ID, so there is no connection string and no
 * key — the identity needs *Storage Blob Data Contributor*, which it already has
 * for the daily challenge. Local development points at Azurite with the
 * well-known development connection string, a fixed test credential and not a
 * secret.
 */
export function createBlobRoomStore(
  endpointOrConnectionString: string,
  containerName = CONTAINER
): RoomStore {
  const service =
    endpointOrConnectionString.includes('AccountKey=') ||
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

  async function write(room: Room, version: string | null): Promise<void> {
    await ensureContainer();
    const body = JSON.stringify(room);

    try {
      await container.getBlockBlobClient(blobName(room.code)).upload(body, Buffer.byteLength(body), {
        blobHTTPHeaders: { blobContentType: 'application/json' },
        // A version of null says "this room must not exist yet"; otherwise the
        // blob has to still be exactly the one that was read.
        conditions: version === null ? { ifNoneMatch: '*' } : { ifMatch: version },
      });
    } catch (err) {
      if (isConflict(err)) throw new RoomVersionConflict(room.code);
      throw err;
    }
  }

  return {
    async create(room) {
      await write(room, null);
    },

    async get(code): Promise<StoredRoom | null> {
      try {
        const response = await container.getBlockBlobClient(blobName(code)).download();
        if (!response.readableStreamBody) return null;

        const room = JSON.parse(await readAll(response.readableStreamBody)) as Room;
        // The ETag comes back quoted; it is passed straight back to the service
        // on the next write, so it is never interpreted here.
        return { room, version: response.etag ?? null };
      } catch (err) {
        // ⚠️ Only 404 means "no such room". A 403 is this deployment's identity
        // missing its role on the container, and reporting that as an absent room
        // sent every player the words "That room has closed." while the real
        // fault — a missing role assignment — never surfaced anywhere.
        if (err instanceof RestError && err.statusCode === 404) return null;
        throw err;
      }
    },

    async put({ room, version }) {
      await write(room, version);
    },

    async delete(code) {
      await container.getBlockBlobClient(blobName(code)).deleteIfExists();
    },
  };
}
