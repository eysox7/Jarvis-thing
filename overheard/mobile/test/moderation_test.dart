// Telefondaki içerik denetimi, sunucudakiyle (server/moderation.js) aynı sonucu vermeli. Örnek metinler
// iki tarafta da işlenip karşılaştırılır; node bulunamazsa yalnızca Dart beklentileri denetlenir.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:overheard/core/api.dart';
import 'package:overheard/core/moderation.dart';

const samples = [
  'Vapurda biri: "Martılar da zam yaptı."',
  'Beni 0532 123 45 67\'den ara dedi',
  'Mail at: deneme.kisi@ornek.com.tr',
  'Plakası 34 ABC 123 olan araba yine park etti',
  'Bak şu @ahmet_yilmaz ne diyor',
  'Detaylar www.ornek.com/kampanya adresinde',
  'Siktir git dedi otobüs şoförü',
  'S1KT1RRR ya, yine mi metro arızalı',
  'Holy shit the train is late again',
  'AMK bu ne trafik',
  'Picnic ve got kelimeleri masum',
  'İstanbul\'da IŞIK ŞÖLENİ var',
  'Call me at (512) 555-1234 tonight',
];

void main() {
  test('nefret söylemi reddedilir; kişisel veri ve küfür maskelenir', () {
    expect(() => moderatePublicText('Sen tam bir ibne gibisin'), throwsA(isA<ApiException>()));
    expect(containsSlur('1BN3'), isTrue);
    expect(moderatePublicText('Beni 0532 123 45 67\'den ara'), contains('[telefon]'));
    expect(moderatePublicText('Bak şu @ahmet ne diyor'), 'Bak şu [kişi] ne diyor');
    expect(moderatePublicText('Siktir git'), 'S***** git');
    expect(moderatePublicText('Picnic ve got'), 'Picnic ve got');
    expect(normalizeWord('S1KT1RRR'), 'siktir');
  });

  final root = Directory.current.parent.path;
  final hasNode = File('$root/server/moderation.js').existsSync() && Process.runSync('which', ['node']).exitCode == 0;

  test('sunucudaki denetimle aynı sonuç', () async {
    const script = '''
      import { moderatePublicText, containsSlur } from './server/moderation.js';
      const samples = JSON.parse(process.argv[1]);
      console.log(JSON.stringify(samples.map((s) => {
        try { return { text: moderatePublicText(s).text, slur: containsSlur(s) }; }
        catch (e) { return { error: e.code, slur: true }; }
      })));
    ''';
    final result = await Process.run(
      'node',
      ['--input-type=module', '-e', script, jsonEncode(samples)],
      workingDirectory: root,
      stdoutEncoding: utf8,
    );
    expect(result.exitCode, 0, reason: '${result.stderr}');
    final expected = (jsonDecode(result.stdout as String) as List).cast<Map<String, dynamic>>();
    for (var i = 0; i < samples.length; i++) {
      final want = expected[i];
      expect(containsSlur(samples[i]), want['slur'], reason: samples[i]);
      if (want['error'] != null) {
        expect(() => moderatePublicText(samples[i]), throwsA(isA<ApiException>()), reason: samples[i]);
      } else {
        expect(moderatePublicText(samples[i]), want['text'], reason: samples[i]);
      }
    }
  }, skip: hasNode ? false : 'node bulunamadı');
}
