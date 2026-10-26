package app.overheard.overheard

import android.content.Context
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.embedding.engine.FlutterEngineCache
import io.flutter.embedding.engine.dart.DartExecutor

// Flutter motoru uygulama süreci boyunca yaşar: ekran kapansa ya da uygulama son uygulamalardan
// kaydırılsa da Dart tarafı (yeraltı ağı, söz deposu) çalışmaya devam eder; uygulama yeniden
// açılınca aynı motora bağlanılır. Süreç yeraltı modu açıkken ön plan hizmetiyle (MeshService) ayakta kalır.
class MainActivity : FlutterActivity() {
    override fun provideFlutterEngine(context: Context): FlutterEngine =
        FlutterEngineCache.getInstance().get(ENGINE_ID) ?: FlutterEngine(context.applicationContext).also { engine ->
            engine.plugins.add(MeshPlugin())
            engine.dartExecutor.executeDartEntrypoint(DartExecutor.DartEntrypoint.createDefault())
            FlutterEngineCache.getInstance().put(ENGINE_ID, engine)
        }

    override fun shouldDestroyEngineWithHost(): Boolean = false

    private companion object {
        const val ENGINE_ID = "overheard"
    }
}
