export async function prepareImage(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error("Use a PNG, JPEG or WebP image.");
  if (file.size > 10 * 1024 * 1024)
    throw new Error("Choose an image smaller than 10 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 1280 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image processing is unavailable.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.88);
  } catch (e) {
    if (e instanceof Error && e.message === "Image processing is unavailable.")
      throw e;
    throw new Error(
      "This image could not be read. Try another PNG, JPEG or WebP file.",
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
