import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// İmza anahtarları depoda durmaz.
// - Play Store: android/key.properties (storeFile, storePassword, keyAlias, keyPassword).
// - Pilot (CI'daki ve elle dağıtılan derlemeler): OVERHEARD_PILOT_KEYSTORE (dosya yolu) ve
//   OVERHEARD_PILOT_PASSWORD ortam değişkenleri. CI bunları depo sırlarından (PILOT_KEYSTORE_B64,
//   PILOT_KEYSTORE_PASSWORD) kurar. Her pilot derlemesi aynı imzayı (ve Google girişi için aynı
//   SHA-1'i) taşır.
// İkisi de yoksa derleme bu makinenin hata ayıklama anahtarıyla imzalanır: yalnızca o makinede
// deneme içindir, başka yerde derlenmiş sürümün üstüne kurulmaz.
val keystoreFile = rootProject.file("key.properties")
val keystore = Properties().apply { if (keystoreFile.exists()) FileInputStream(keystoreFile).use { load(it) } }
val pilotKeystore = System.getenv("OVERHEARD_PILOT_KEYSTORE")?.let { file(it) }?.takeIf { it.exists() }
val pilotPassword = System.getenv("OVERHEARD_PILOT_PASSWORD").orEmpty()
val hasPilot = pilotKeystore != null && pilotPassword.isNotEmpty()

android {
    namespace = "app.overheard.overheard"
    // permission_handler_android Android 37 API'siyle derlenmeyi istiyor.
    compileSdk = 37
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "app.overheard"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        manifestPlaceholders["usesCleartextTraffic"] = "false"
    }

    signingConfigs {
        if (hasPilot) {
            create("pilot") {
                storeFile = pilotKeystore
                storePassword = pilotPassword
                keyAlias = "pilot"
                keyPassword = pilotPassword
            }
        }
        if (keystoreFile.exists()) {
            create("upload") {
                storeFile = file(keystore.getProperty("storeFile"))
                storePassword = keystore.getProperty("storePassword")
                keyAlias = keystore.getProperty("keyAlias")
                keyPassword = keystore.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        debug {
            if (hasPilot) signingConfig = signingConfigs.getByName("pilot")
            manifestPlaceholders["usesCleartextTraffic"] = "true"
        }
        release {
            signingConfig = signingConfigs.getByName(
                when {
                    keystoreFile.exists() -> "upload"
                    hasPilot -> "pilot"
                    else -> "debug"
                },
            )
            // Cihazda denenmemiş eklentilerde (Nearby) R8'in bir şeyi silmesi riskine girilmez.
            isMinifyEnabled = false
            isShrinkResources = false
            // Yerel ağdaki http:// sunucuyla denemek için: ORG_GRADLE_PROJECT_overheardCleartext=true
            manifestPlaceholders["usesCleartextTraffic"] = (project.findProperty("overheardCleartext") as String?) ?: "false"
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

dependencies {
    // Yeraltı modu: telefonlar arası internetsiz bağlantı (MeshPlugin) ve ön plan hizmeti bildirimi.
    implementation("com.google.android.gms:play-services-nearby:19.3.0")
    implementation("androidx.core:core-ktx:1.17.0")
}
