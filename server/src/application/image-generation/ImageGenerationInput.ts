import { ImageGenerationError } from '../../domain/image-generation/ImageGeneration.js';

export type ImageGenerationInput = {
  width?: number;
  height?: number;
  images?: { data: Buffer; mimeType: string }[];
};
export type StoredImageGenerationInput = {
  width?: number;
  height?: number;
  images: string[];
};

export function prepareImageInput(input: ImageGenerationInput): StoredImageGenerationInput {
  for (const size of [input.width, input.height]) {
    if (size !== undefined && (!Number.isInteger(size) || size < 256 || size > 4096)) {
      throw new ImageGenerationError(400, 'Размер изображения должен быть от 256 до 4096 пикселей');
    }
  }
  const images = input.images ?? [];
  if (images.length > 8 || images.reduce((sum, image) => sum + image.data.length, 0) > 24 * 1024 * 1024) {
    throw new ImageGenerationError(400, 'До восьми референсов общим размером до 24 МБ');
  }
  return { width: input.width, height: input.height, images: images.map(image => {
    const png = image.mimeType === 'image/png' && image.data.length >= 24
      && image.data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      && image.data.toString('ascii', 12, 16) === 'IHDR';
    const jpeg = image.mimeType === 'image/jpeg' && image.data.length >= 4
      && image.data[0] === 255 && image.data[1] === 216 && image.data[2] === 255;
    if ((!png && !jpeg) || image.data.length > 6 * 1024 * 1024) {
      throw new ImageGenerationError(400, 'Референс должен быть PNG или JPEG до 6 МБ');
    }
    return `data:${image.mimeType};base64,${image.data.toString('base64')}`;
  }) };
}
