import { Router } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/validate';
import { photoRepository } from '../repositories/photoRepository';
import { photoStorageService } from '../services/photoStorageService';

export const photoRoutes = Router();

photoRoutes.use(requireAuth);

/**
 * Serves a photo to its owner only. There is no public URL and no signed link
 * that outlives the session — every request re-authenticates and the query
 * itself is scoped by user id.
 */
photoRoutes.get(
  '/:photoId',
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const { buffer, contentType } = await photoStorageService.read(req.userId, req.params.photoId);
    res.set({
      'Content-Type': contentType,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    });
    res.send(buffer);
  }),
);

/** Metadata only — the Progress and History screens never render these. */
photoRoutes.get(
  '/',
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const photos = await photoRepository.listOwned(req.userId);
    res.json({
      photos: photos.map((photo) => ({
        id: photo.id,
        createdAt: photo.created_at.toISOString(),
        byteSize: photo.byte_size,
        purpose: photo.purpose,
      })),
    });
  }),
);
