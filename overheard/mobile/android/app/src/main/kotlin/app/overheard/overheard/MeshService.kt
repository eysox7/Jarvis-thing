package app.overheard.overheard

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

// Yeraltı modu açıkken telefon cepteyken de süren ön plan hizmeti (connectedDevice). Uygulama son
// uygulamalardan kaydırılsa da çalışmaya devam eder (Flutter motoru önbellekte, MainActivity);
// bildirimdeki "Kapat" düğmesiyle ya da uygulamadan kapatılır.
class MeshService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        running = this
    }

    override fun onDestroy() {
        if (running === this) running = null
        super.onDestroy()
    }

    // Çalışan hizmetin bildirimini günceller (yakındaki telefon sayısı). Hizmeti yeniden başlatmak
    // gerekmez; Android 12+ uygulama arka plandayken buna zaten izin vermez.
    fun show(title: String, text: String, stop: String, channel: String) {
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification(title, text, stop, channel))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            MeshPlugin.instance?.emit(mapOf("type" to "stopRequested"))
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        val notification = notification(
            intent?.getStringExtra(EXTRA_TITLE) ?: "Overheard",
            intent?.getStringExtra(EXTRA_TEXT) ?: "",
            intent?.getStringExtra(EXTRA_STOP) ?: "Stop",
            intent?.getStringExtra(EXTRA_CHANNEL) ?: "Overheard",
        )
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE else 0
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
        return START_NOT_STICKY
    }

    private fun notification(title: String, text: String, stop: String, channelName: String): Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, channelName, NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
        val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        val open = packageManager.getLaunchIntentForPackage(packageName)?.let { PendingIntent.getActivity(this, 0, it, flags) }
        val close = PendingIntent.getService(this, 1, Intent(this, MeshService::class.java).setAction(ACTION_STOP), flags)
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(open)
            .addAction(0, stop, close)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    companion object {
        private const val CHANNEL_ID = "underground"
        private const val NOTIFICATION_ID = 7
        private const val ACTION_STOP = "app.overheard.mesh.STOP"
        private const val EXTRA_TITLE = "title"
        private const val EXTRA_TEXT = "text"
        private const val EXTRA_STOP = "stop"
        private const val EXTRA_CHANNEL = "channel"

        @Volatile
        private var running: MeshService? = null

        // Hizmeti başlatır (çalışıyorsa yalnızca bildirimini günceller). Android 12+ arka plandan ön
        // plan hizmeti başlatmaya izin vermez; o durumda false döner (uygulama öne gelince yeniden denenir).
        fun start(context: Context, title: String, text: String, stop: String, channel: String): Boolean {
            running?.let {
                it.show(title, text, stop, channel)
                return true
            }
            return try {
                val intent = Intent(context, MeshService::class.java)
                    .putExtra(EXTRA_TITLE, title)
                    .putExtra(EXTRA_TEXT, text)
                    .putExtra(EXTRA_STOP, stop)
                    .putExtra(EXTRA_CHANNEL, channel)
                ContextCompat.startForegroundService(context, intent)
                true
            } catch (e: RuntimeException) {
                Log.w("Overheard", "Yeraltı hizmeti başlatılamadı", e)
                false
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, MeshService::class.java))
        }
    }
}
