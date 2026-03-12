package com.anonymous.main.tgs

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.PorterDuff
import android.net.Uri
import com.airbnb.lottie.LottieCompositionFactory
import com.airbnb.lottie.LottieDrawable
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.io.InputStreamReader
import java.util.zip.GZIPInputStream
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

class TgsConverterModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "TgsConverter"

  @ReactMethod
  fun renderFrames(sourceUri: String, width: Int, height: Int, fps: Double, maxDurationMs: Double, promise: Promise) {
    Thread {
      try {
        if (sourceUri.isBlank()) {
          throw IllegalArgumentException("Source URI is empty.")
        }

        val json = readTgsJson(sourceUri)
        // Use the synchronous API to access the parsed composition/result safely.
        val compositionResult = LottieCompositionFactory.fromJsonStringSync(json, null)
        val composition = compositionResult.value
          ?: throw IllegalStateException(compositionResult.exception?.message ?: "Failed to parse TGS.")

        val compWidth = composition.bounds.width().coerceAtLeast(1)
        val compHeight = composition.bounds.height().coerceAtLeast(1)

        val totalFrames = composition.endFrame - composition.startFrame
        val frameRate = composition.frameRate.coerceAtLeast(1f)
        val durationMs = ((totalFrames.toDouble() / frameRate.toDouble()) * 1000.0).coerceAtLeast(1.0)
        val cappedDurationMs = min(durationMs, maxDurationMs.coerceAtLeast(500.0))
        val targetFps = fps.coerceAtLeast(1.0)
        val frameCount = max(1, (cappedDurationMs / 1000.0 * targetFps).roundToInt())
        val durationScale = (cappedDurationMs / durationMs).coerceAtMost(1.0).toFloat()

        val outputDir = File(reactContext.cacheDir, "tgs_frames_${System.currentTimeMillis()}")
        outputDir.mkdirs()

        val drawable = LottieDrawable()
        drawable.composition = composition
        drawable.setBounds(0, 0, compWidth, compHeight)

        val scale = min(width.toFloat() / compWidth.toFloat(), height.toFloat() / compHeight.toFloat())
        val dx = (width - compWidth * scale) / 2f
        val dy = (height - compHeight * scale) / 2f

        for (i in 0 until frameCount) {
          val progressBase = if (frameCount == 1) 0f else i.toFloat() / (frameCount - 1).toFloat()
          val progress = (progressBase * durationScale).coerceIn(0f, 1f)
          drawable.progress = progress

          val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
          val canvas = Canvas(bitmap)
          canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
          canvas.save()
          canvas.translate(dx, dy)
          canvas.scale(scale, scale)
          drawable.draw(canvas)
          canvas.restore()

          val frameFile = File(outputDir, "frame-${String.format("%03d", i)}.png")
          frameFile.outputStream().use { out ->
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
          }
          bitmap.recycle()
        }

        val result = Arguments.createMap()
        result.putString("framesDir", outputDir.absolutePath)
        result.putString("pattern", "frame-%03d.png")
        result.putInt("frameCount", frameCount)
        result.putDouble("fps", targetFps)
        result.putDouble("durationMs", cappedDurationMs)
        promise.resolve(result)
      } catch (e: Exception) {
        promise.reject("TGS_CONVERT_FAILED", e.message, e)
      }
    }.start()
  }

  private fun readTgsJson(sourceUri: String): String {
    val uri = Uri.parse(sourceUri)
    val stream: InputStream = if (uri.scheme == "content") {
      reactContext.contentResolver.openInputStream(uri) ?: throw IllegalStateException("Unable to open content URI.")
    } else {
      val path = sourceUri.replaceFirst("^file://".toRegex(), "")
      FileInputStream(path)
    }
    stream.use { input ->
      GZIPInputStream(input).use { gzip ->
        InputStreamReader(gzip).use { reader ->
          return reader.readText()
        }
      }
    }
  }
}
