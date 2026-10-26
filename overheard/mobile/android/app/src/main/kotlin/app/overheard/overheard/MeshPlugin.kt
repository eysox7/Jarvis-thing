package app.overheard.overheard

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.AdvertisingOptions
import com.google.android.gms.nearby.connection.ConnectionInfo
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback
import com.google.android.gms.nearby.connection.ConnectionResolution
import com.google.android.gms.nearby.connection.ConnectionsStatusCodes
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo
import com.google.android.gms.nearby.connection.DiscoveryOptions
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback
import com.google.android.gms.nearby.connection.Payload
import com.google.android.gms.nearby.connection.PayloadCallback
import com.google.android.gms.nearby.connection.PayloadTransferUpdate
import com.google.android.gms.nearby.connection.Strategy
import com.google.android.gms.tasks.Task
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

// Yeraltı modunun Android katmanı: Google Nearby Connections (Bluetooth, BLE, Wi-Fi; internet
// istemez). İstemci uygulama bağlamıyla kurulur, ekran (Activity) kapansa da bağlantılar sürer.
// Kime ne zaman bağlanılacağı Dart tarafındadır (nearby_link.dart); burası temel işlemleri yapar ve
// olayları iletir. Gelen bağlantılar kendiliğinden kabul edilir: sözler imzalıdır ve zaten
// yanındakilerin okuyacağı metinlerdir.
class MeshPlugin : FlutterPlugin, MethodChannel.MethodCallHandler, EventChannel.StreamHandler {
    private lateinit var context: Context
    private var methods: MethodChannel? = null
    private var events: EventChannel? = null
    private var sink: EventChannel.EventSink? = null
    private val main = Handler(Looper.getMainLooper())
    private val client by lazy { Nearby.getConnectionsClient(context) }
    private var name = ""

    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        context = binding.applicationContext
        methods = MethodChannel(binding.binaryMessenger, "app.overheard/mesh").also { it.setMethodCallHandler(this) }
        events = EventChannel(binding.binaryMessenger, "app.overheard/mesh/events").also { it.setStreamHandler(this) }
        instance = this
    }

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        methods?.setMethodCallHandler(null)
        events?.setStreamHandler(null)
        if (instance === this) instance = null
    }

    override fun onListen(arguments: Any?, events: EventChannel.EventSink) {
        sink = events
    }

    override fun onCancel(arguments: Any?) {
        sink = null
    }

    // Olaylar her zaman ana iş parçacığından gönderilir (Flutter kanalı bunu ister).
    fun emit(event: Map<String, Any?>) {
        main.post { sink?.success(event) }
    }

    private fun log(message: String) = emit(mapOf("type" to "log", "message" to message))

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "start" -> start(call.argument<String>("name")!!, call.argument<String>("serviceId")!!, result)
            "stop" -> {
                client.stopAdvertising()
                client.stopDiscovery()
                client.stopAllEndpoints()
                result.success(null)
            }
            "connect" -> {
                val id = call.argument<String>("id")!!
                answer(client.requestConnection(name, id, lifecycle), result, "Bağlantı isteği ($id)")
            }
            "send" -> {
                val id = call.argument<String>("id")!!
                answer(client.sendPayload(id, Payload.fromBytes(call.argument<ByteArray>("bytes")!!)), result, "Gönderim ($id)")
            }
            "disconnect" -> {
                client.disconnectFromEndpoint(call.argument<String>("id")!!)
                result.success(null)
            }
            "keepAlive" -> {
                val started = MeshService.start(
                    context,
                    call.argument<String>("title") ?: "Overheard",
                    call.argument<String>("text") ?: "",
                    call.argument<String>("stop") ?: "Stop",
                    call.argument<String>("channel") ?: "Overheard",
                )
                result.success(started)
            }
            "release" -> {
                MeshService.stop(context)
                result.success(null)
            }
            else -> result.notImplemented()
        }
    }

    private fun answer(task: Task<Void>, result: MethodChannel.Result, what: String) {
        task.addOnSuccessListener { result.success(true) }
            .addOnFailureListener { e ->
                log("$what olmadı: ${describe(e)}")
                result.success(false)
            }
    }

    // Görünür olmak ve aramak ayrı ayrı başlar; ikisinden biri olsa da yeraltı ağı çalışır.
    private fun start(name: String, serviceId: String, result: MethodChannel.Result) {
        this.name = name
        val strategy = Strategy.P2P_CLUSTER
        var advertising: Boolean? = null
        var discovering: Boolean? = null
        fun finish() {
            val adv = advertising ?: return
            val disc = discovering ?: return
            result.success(mapOf("advertising" to adv, "discovering" to disc))
        }
        client.startAdvertising(name, serviceId, lifecycle, AdvertisingOptions.Builder().setStrategy(strategy).build())
            .addOnSuccessListener { advertising = true; finish() }
            .addOnFailureListener { e ->
                advertising = already(e, ConnectionsStatusCodes.STATUS_ALREADY_ADVERTISING)
                if (advertising == false) log("Görünür olunamadı: ${describe(e)}")
                finish()
            }
        client.startDiscovery(serviceId, discovery, DiscoveryOptions.Builder().setStrategy(strategy).build())
            .addOnSuccessListener { discovering = true; finish() }
            .addOnFailureListener { e ->
                discovering = already(e, ConnectionsStatusCodes.STATUS_ALREADY_DISCOVERING)
                if (discovering == false) log("Arama başlatılamadı: ${describe(e)}")
                finish()
            }
    }

    private fun already(e: Exception, code: Int) = (e as? ApiException)?.statusCode == code

    private fun describe(e: Exception): String {
        val code = (e as? ApiException)?.statusCode ?: return e.message ?: e.javaClass.simpleName
        return "${ConnectionsStatusCodes.getStatusCodeString(code)} ($code)"
    }

    private val lifecycle = object : ConnectionLifecycleCallback() {
        override fun onConnectionInitiated(id: String, info: ConnectionInfo) {
            emit(mapOf("type" to "initiated", "id" to id, "name" to info.endpointName, "incoming" to info.isIncomingConnection))
            client.acceptConnection(id, payloads).addOnFailureListener { e -> log("Bağlantı kabul edilemedi ($id): ${describe(e)}") }
        }

        override fun onConnectionResult(id: String, resolution: ConnectionResolution) {
            val status = resolution.status
            emit(mapOf("type" to if (status.isSuccess) "connected" else "failed", "id" to id, "code" to status.statusCode))
        }

        override fun onDisconnected(id: String) = emit(mapOf("type" to "disconnected", "id" to id))
    }

    private val discovery = object : EndpointDiscoveryCallback() {
        override fun onEndpointFound(id: String, info: DiscoveredEndpointInfo) =
            emit(mapOf("type" to "found", "id" to id, "name" to info.endpointName))

        override fun onEndpointLost(id: String) = emit(mapOf("type" to "lost", "id" to id))
    }

    private val payloads = object : PayloadCallback() {
        override fun onPayloadReceived(id: String, payload: Payload) {
            if (payload.type != Payload.Type.BYTES) return
            payload.asBytes()?.let { emit(mapOf("type" to "payload", "id" to id, "bytes" to it)) }
        }

        override fun onPayloadTransferUpdate(id: String, update: PayloadTransferUpdate) {}
    }

    companion object {
        // Bildirimdeki "Kapat" düğmesi olayı Dart'a buradan iletilir.
        @Volatile
        var instance: MeshPlugin? = null
    }
}
