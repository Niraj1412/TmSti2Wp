package com.anonymous.main

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    setTheme(R.style.AppTheme);
    super.onCreate(null)
    handleIncomingIntent(intent)
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleIncomingIntent(intent)
  }

  /**
    * Align the back button behavior with Android S
    * where moving root activities to background instead of finishing activities.
    * @see <a href="https://developer.android.com/reference/android/app/Activity#onBackPressed()">onBackPressed</a>
    */
  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              // For non-root activities, use the default implementation to finish them.
              super.invokeDefaultOnBackPressed()
          }
          return
      }

      // Use the default back button implementation on Android S
      // because it's doing more than [Activity.moveTaskToBack] in fact.
      super.invokeDefaultOnBackPressed()
  }

  private fun handleIncomingIntent(incoming: Intent?) {
      if (incoming == null) return
      val action = incoming.action ?: return
      if (action != Intent.ACTION_SEND && action != Intent.ACTION_SEND_MULTIPLE && action != Intent.ACTION_VIEW) return

      val uri: Uri? = when (action) {
          Intent.ACTION_SEND -> incoming.getParcelableExtra(Intent.EXTRA_STREAM) ?: incoming.data
          Intent.ACTION_SEND_MULTIPLE -> {
              val list = incoming.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
              list?.firstOrNull() ?: incoming.data
          }
          else -> incoming.data
      }

      if (uri == null) return

      val mime = incoming.type ?: try {
          contentResolver.getType(uri)
      } catch (_e: Exception) {
          null
      }

      val wrapped = buildStickerOpenUri(uri, mime)
      incoming.data = wrapped
      setIntent(incoming)
  }

  private fun buildStickerOpenUri(uri: Uri, mime: String?): Uri {
      val builder = Uri.Builder()
          .scheme("stickerconverter")
          .authority("open")
          .appendQueryParameter("uri", uri.toString())
      if (!mime.isNullOrBlank()) {
          builder.appendQueryParameter("mime", mime)
      }
      return builder.build()
  }
}
