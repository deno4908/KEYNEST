import express from "express";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AppError } from "./security.js";
import { productImages } from "../shared/product-images.js";

const filePattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.webp$/;
export const isStoreImage = (value) =>
  Object.values(productImages).includes(value) ||
  /^https:\/\/shared\.fastly\.steamstatic\.com\/[a-zA-Z0-9_./-]+$/.test(
    value,
  ) ||
  (value.startsWith("/api/media/") && filePattern.test(value.slice(11)));

export function mediaRouter({ store, mode, auth, admin, limiter }) {
  const router = express.Router();
  const directory =
    mode === "demo" ? join(dirname(store.path), "uploads") : null;
  router.get("/media/:file", async (req, res) => {
    if (!filePattern.test(req.params.file))
      throw new AppError("Không tìm thấy ảnh.", 404);
    let buffer;
    if (directory) {
      try {
        buffer = await readFile(join(directory, req.params.file));
      } catch (e) {
        if (e.code === "ENOENT") throw new AppError("Không tìm thấy ảnh.", 404);
        throw e;
      }
    } else {
      const { data, error } = await store.client.storage
        .from("store-assets")
        .download(req.params.file);
      if (error) throw new AppError("Không thể tải ảnh.", 404);
      buffer = Buffer.from(await data.arrayBuffer());
    }
    res
      .set({
        "Content-Type": "image/webp",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      })
      .send(buffer);
  });
  const avatarLimit = limiter(5, 15 * 60000);
  const adminLimit = limiter(20, 15 * 60000);
  const avatarBody = express.raw({
    type: ["image/jpeg", "image/png", "image/webp"],
    limit: "4mb",
  });
  const adminBody = express.raw({
    type: ["image/jpeg", "image/png", "image/webp"],
    limit: "8mb",
  });
  router.post(
    ["/admin/media", "/me/avatar"],
    auth,
    (req, res, next) =>
      req.path === "/me/avatar" ? next() : admin(req, res, next),
    (req, res, next) =>
      (req.path === "/me/avatar" ? avatarLimit : adminLimit)(req, res, next),
    (req, res, next) =>
      (req.path === "/me/avatar" ? avatarBody : adminBody)(req, res, next),
    async (req, res) => {
      const avatar = req.path === "/me/avatar";
      if (!Buffer.isBuffer(req.body) || !req.body.length)
        throw new AppError(
          `Chọn ảnh JPG, PNG hoặc WebP, tối đa ${avatar ? 4 : 8} MB.`,
          415,
        );
      const input = req.body;
      const isJpeg =
        input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff;
      const isPng = input
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const isWebp =
        input.toString("ascii", 0, 4) === "RIFF" &&
        input.toString("ascii", 8, 12) === "WEBP";
      if (!(isJpeg || isPng || isWebp))
        throw new AppError("Nội dung tập tin không phải ảnh hợp lệ.");
      let result;
      try {
        const decoder = sharp(input, {
          limitInputPixels: 24000000,
          failOn: "warning",
        });
        const meta = await decoder.metadata();
        if (
          (meta.pages || 1) > 1 ||
          !["jpeg", "png", "webp"].includes(meta.format)
        )
          throw new Error("unsupported");
        result = await decoder
          .rotate()
          .resize({
            width: avatar ? 512 : 2400,
            height: avatar ? 512 : 2400,
            fit: avatar ? "cover" : "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: 88 })
          .toBuffer({ resolveWithObject: true });
      } catch {
        throw new AppError(
          "Ảnh bị lỗi, là ảnh động hoặc vượt quá 24 megapixel. Hãy chọn ảnh tĩnh khác.",
        );
      }
      const filename = `${randomUUID()}.webp`;
      if (directory) {
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, filename), result.data, { flag: "wx" });
      } else {
        const { error } = await store.client.storage
          .from("store-assets")
          .upload(filename, result.data, {
            contentType: "image/webp",
            cacheControl: "31536000",
            upsert: false,
          });
        if (error)
          throw new AppError(
            "Không lưu được ảnh. Kiểm tra cấu hình Storage và migration của cửa hàng.",
            503,
          );
      }
      if (avatar) {
        // Save binary first. Retain an orphan on ambiguous DB failure rather
        // than deleting a photo that a committed profile could reference.
        const profile = await store.updateProfile(req.user.id, {
          avatar_url: `/api/media/${filename}`,
          avatar_source: "upload",
        });
        return res.status(201).json(profile);
      }
      await store.audit(req.user.id, "upload_image", filename);
      res.status(201).json({
        url: `/api/media/${filename}`,
        width: result.info.width,
        height: result.info.height,
        bytes: result.info.size,
      });
    },
  );
  return router;
}
