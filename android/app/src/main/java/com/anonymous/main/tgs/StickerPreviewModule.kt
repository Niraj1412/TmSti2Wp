package com.anonymous.main.tgs

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileOutputStream
import java.util.ArrayDeque
import kotlin.math.min
import kotlin.math.roundToInt

class StickerPreviewModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "StickerPreview"

  @ReactMethod
  fun createPreview(sourceUri: String, width: Int, height: Int, promise: Promise) {
    Thread {
      try {
        if (sourceUri.isBlank()) {
          throw IllegalArgumentException("Source URI is empty.")
        }

        val bitmap = decodeBitmap(sourceUri) ?: throw IllegalStateException("Unable to decode sticker preview.")
        val targetWidth = width.coerceAtLeast(1)
        val targetHeight = height.coerceAtLeast(1)
        val outputBitmap = scaleContain(bitmap, targetWidth, targetHeight)
        if (outputBitmap !== bitmap) {
          bitmap.recycle()
        }

        val result = saveBitmap(outputBitmap, "preview")
        outputBitmap.recycle()
        promise.resolve(result)
      } catch (e: Exception) {
        promise.reject("PREVIEW_CREATE_FAILED", e.message, e)
      }
    }.start()
  }

  @ReactMethod
  fun cropSquare(sourceUri: String, promise: Promise) {
    Thread {
      try {
        if (sourceUri.isBlank()) throw IllegalArgumentException("Source URI is empty.")
        val bitmap = decodeBitmap(sourceUri) ?: throw IllegalStateException("Unable to decode image.")
        val cropped = centerCropSquare(bitmap)
        if (cropped !== bitmap) {
          bitmap.recycle()
        }
        val result = saveBitmap(cropped, "crop")
        cropped.recycle()
        promise.resolve(result)
      } catch (e: Exception) {
        promise.reject("CROP_SQUARE_FAILED", e.message, e)
      }
    }.start()
  }

  @ReactMethod
  fun removeBackgroundBasic(sourceUri: String, tolerance: Int, promise: Promise) {
    Thread {
      try {
        if (sourceUri.isBlank()) throw IllegalArgumentException("Source URI is empty.")
        val bitmap = decodeBitmap(sourceUri) ?: throw IllegalStateException("Unable to decode image.")
        val mutableBitmap = bitmap.copy(Bitmap.Config.ARGB_8888, true)
          ?: throw IllegalStateException("Unable to create mutable bitmap.")
        if (mutableBitmap !== bitmap) {
          bitmap.recycle()
        }
        clearBackgroundConnectedToBorder(mutableBitmap, tolerance.coerceIn(10, 100))
        val result = saveBitmap(mutableBitmap, "bg")
        mutableBitmap.recycle()
        promise.resolve(result)
      } catch (e: Exception) {
        promise.reject("REMOVE_BG_BASIC_FAILED", e.message, e)
      }
    }.start()
  }

  private fun decodeBitmap(sourceUri: String): Bitmap? {
    val uri = Uri.parse(sourceUri)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      try {
        val source = if (uri.scheme == "content" || uri.scheme == "file") {
          ImageDecoder.createSource(reactContext.contentResolver, uri)
        } else {
          val file = File(sourceUri.replaceFirst("^file://".toRegex(), ""))
          ImageDecoder.createSource(file)
        }
        return ImageDecoder.decodeBitmap(source) { decoder, _, _ ->
          decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
          decoder.isMutableRequired = false
        }
      } catch (_: Exception) {
        // Fall back to BitmapFactory for unsupported formats on older decoders.
      }
    }

    return try {
      val stream = if (uri.scheme == "content") {
        reactContext.contentResolver.openInputStream(uri)
      } else {
        val file = File(sourceUri.replaceFirst("^file://".toRegex(), ""))
        if (!file.exists()) null else file.inputStream()
      }
      stream.use { input ->
        if (input == null) null else BitmapFactory.decodeStream(input)
      }
    } catch (_: Exception) {
      null
    }
  }

  private fun scaleContain(bitmap: Bitmap, targetWidth: Int, targetHeight: Int): Bitmap {
    if (bitmap.width <= 0 || bitmap.height <= 0) return bitmap
    val scale = min(
      targetWidth.toFloat() / bitmap.width.toFloat(),
      targetHeight.toFloat() / bitmap.height.toFloat(),
    ).coerceAtLeast(0.0001f)

    val scaledWidth = (bitmap.width * scale).roundToInt().coerceAtLeast(1)
    val scaledHeight = (bitmap.height * scale).roundToInt().coerceAtLeast(1)
    val scaled = Bitmap.createScaledBitmap(bitmap, scaledWidth, scaledHeight, true)

    if (scaledWidth == targetWidth && scaledHeight == targetHeight) {
      return scaled
    }

    val output = Bitmap.createBitmap(targetWidth, targetHeight, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(output)
    val left = ((targetWidth - scaledWidth) / 2f).coerceAtLeast(0f)
    val top = ((targetHeight - scaledHeight) / 2f).coerceAtLeast(0f)
    canvas.drawBitmap(scaled, left, top, null)
    scaled.recycle()
    return output
  }

  private fun centerCropSquare(bitmap: Bitmap): Bitmap {
    val width = bitmap.width
    val height = bitmap.height
    if (width <= 0 || height <= 0) return bitmap
    val size = min(width, height)
    if (size <= 0) return bitmap
    val left = ((width - size) / 2).coerceAtLeast(0)
    val top = ((height - size) / 2).coerceAtLeast(0)
    return Bitmap.createBitmap(bitmap, left, top, size, size)
  }

  private fun clearBackgroundConnectedToBorder(bitmap: Bitmap, tolerance: Int) {
    val width = bitmap.width
    val height = bitmap.height
    if (width <= 0 || height <= 0) return

    val backgroundColor = estimateBackgroundColor(bitmap)
    val toleranceSq = tolerance * tolerance
    val visited = BooleanArray(width * height)
    val queue = ArrayDeque<Int>()

    fun tryEnqueue(x: Int, y: Int) {
      if (x < 0 || x >= width || y < 0 || y >= height) return
      val idx = y * width + x
      if (visited[idx]) return
      val color = bitmap.getPixel(x, y)
      if (Color.alpha(color) <= 16) {
        visited[idx] = true
        return
      }
      if (!isColorNear(color, backgroundColor, toleranceSq)) return
      visited[idx] = true
      queue.add(idx)
    }

    for (x in 0 until width) {
      tryEnqueue(x, 0)
      tryEnqueue(x, height - 1)
    }
    for (y in 0 until height) {
      tryEnqueue(0, y)
      tryEnqueue(width - 1, y)
    }

    while (queue.isNotEmpty()) {
      val idx = queue.removeFirst()
      val x = idx % width
      val y = idx / width
      val color = bitmap.getPixel(x, y)
      bitmap.setPixel(x, y, color and 0x00FFFFFF)
      tryEnqueue(x + 1, y)
      tryEnqueue(x - 1, y)
      tryEnqueue(x, y + 1)
      tryEnqueue(x, y - 1)
    }
  }

  private fun estimateBackgroundColor(bitmap: Bitmap): Int {
    val width = bitmap.width
    val height = bitmap.height
    if (width <= 0 || height <= 0) return Color.WHITE

    val stepX = (width / 24).coerceAtLeast(1)
    val stepY = (height / 24).coerceAtLeast(1)
    var sumR = 0L
    var sumG = 0L
    var sumB = 0L
    var count = 0L

    fun sample(x: Int, y: Int) {
      val c = bitmap.getPixel(x, y)
      if (Color.alpha(c) <= 16) return
      sumR += Color.red(c)
      sumG += Color.green(c)
      sumB += Color.blue(c)
      count += 1
    }

    for (x in 0 until width step stepX) {
      sample(x, 0)
      sample(x, height - 1)
    }
    for (y in 0 until height step stepY) {
      sample(0, y)
      sample(width - 1, y)
    }

    if (count == 0L) {
      val fallback = bitmap.getPixel(0, 0)
      return Color.argb(255, Color.red(fallback), Color.green(fallback), Color.blue(fallback))
    }

    return Color.argb(
      255,
      (sumR / count).toInt().coerceIn(0, 255),
      (sumG / count).toInt().coerceIn(0, 255),
      (sumB / count).toInt().coerceIn(0, 255),
    )
  }

  private fun isColorNear(color: Int, background: Int, toleranceSq: Int): Boolean {
    val dr = Color.red(color) - Color.red(background)
    val dg = Color.green(color) - Color.green(background)
    val db = Color.blue(color) - Color.blue(background)
    return (dr * dr + dg * dg + db * db) <= toleranceSq
  }

  private fun saveBitmap(bitmap: Bitmap, prefix: String): com.facebook.react.bridge.WritableMap {
    val outputDir = File(reactContext.cacheDir, "sticker-preview")
    outputDir.mkdirs()
    val outputFile = File(outputDir, "$prefix-${System.currentTimeMillis()}-${(Math.random() * 10000).toInt()}.png")
    FileOutputStream(outputFile).use { out ->
      bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
    }

    val result = Arguments.createMap()
    result.putString("uri", Uri.fromFile(outputFile).toString())
    result.putString("path", outputFile.absolutePath)
    return result
  }
}
