import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient, RestError } from '@azure/storage-blob';
import { RoomVersionConflict, type Room, type RoomStore, type StoredRoom } from './types';

const CONTAINER = 'rooms';

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

function isConflict(err: unknown): boolean {
  return err instanceof RestError && (err.statusCode === 409 || err.statusCode === 412);
}

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

  function ensureContainer() {
    ensured ??= container.createIfNotExists().catch((err) => {

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

        return { room, version: response.etag ?? null };
      } catch (err) {

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
