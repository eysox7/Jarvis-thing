import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Play Store imzası: android/key.properties (storeFile, storePassword, keyAlias, keyPassword). Dosya
// yoksa sürüm derlemesi depodaki pilot anahtarıyla imzalanır. Yükleme anahtarı depoya eklenmez.
val keystoreFile = rootProject.file("key.properties")
val keystore = Properties().apply { if (keystoreFile.exists()) FileInputStream(keystoreFile).use { load(it) } }

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
        // Pilot anahtarı (depoda; şifresi gizli değil): hata ayıklama ve pilot derlemeleri.
        create("pilot") {
            storeFile = file("pilot.keystore")
            storePassword = "overheard-pilot"
            keyAlias = "pilot"
            keyPassword = "overheard-pilot"
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
            signingConfig = signingConfigs.getByName("pilot")
            manifestPlaceholders["usesCleartextTraffic"] = "true"
        }
        release {
            signingConfig = signingConfigs.getByName(if (keystoreFile.exists()) "upload" else "pilot")
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
