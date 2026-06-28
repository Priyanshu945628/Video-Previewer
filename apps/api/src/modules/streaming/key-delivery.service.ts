import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { kms } from '@vsp/crypto';

/**
 * Unwraps the per-version AES-128 DEK on demand. Called from the streaming
 * controller AFTER all auth + nonce + rate-limit checks have passed.
 *
 * The key is returned as raw bytes; the controller streams it to the player
 * with `Cache-Control: no-store` so it never lands in a disk cache.
 *
 * Architecture seam: when we wire Widevine L1 / FairPlay in the future,
 * this service becomes a `LicenseProxy` that brokers between the CDM and
 * the license server (DRM-ready without rewiring controllers).
 */
@Injectable()
export class KeyDeliveryService {
  constructor(private readonly prisma: PrismaService) {}

  async deliverHlsKey(versionId: string): Promise<Buffer> {
    const version = await this.prisma.assetVersion.findUnique({
      where: { id: versionId },
      select: { encryptionKey: { select: { kekId: true, wrappedDek: true } } },
    });
    if (!version?.encryptionKey) throw new NotFoundException({ code: 'NO_KEY' });
    return kms().unwrap({
      kekId: version.encryptionKey.kekId,
      ciphertext: Buffer.from(version.encryptionKey.wrappedDek),
    });
  }
}
