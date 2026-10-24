plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

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

    buildTypes {
        debug {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
        }
        release {
            // Pilot: hata ayıklama anahtarıyla imzalanır (Play Store için kendi anahtarınla değiştir).
            signingConfig = signingConfigs.getByName("debug")
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
