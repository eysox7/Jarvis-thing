import 'package:flutter_test/flutter_test.dart';
import 'package:overheard/mesh/auto_underground.dart';

void main() {
  const s = 1000;
  late AutoUnderground auto;
  var now = 0;
  AutoAction decide({bool running = false, bool byAuto = false}) =>
      auto.decide(running: running, startedByAuto: byAuto, now: now);

  setUp(() {
    auto = AutoUnderground();
    now = 1700000000000;
  });

  test('hatta binince hemen açılır', () {
    auto.reachability(true, now);
    expect(decide(), AutoAction.none);
    auto.onLine = true;
    expect(decide(), AutoAction.start);
  });

  test('bağlantı 30 sn yoksa açılır; kısa kopmalarda açılmaz', () {
    auto.reachability(true, now);
    auto.reachability(false, now);
    now += 10 * s;
    expect(decide(), AutoAction.none);
    auto.reachability(true, now);
    auto.reachability(false, now += s);
    now += 29 * s;
    expect(decide(), AutoAction.none);
    now += 2 * s;
    expect(decide(), AutoAction.start);
  });

  test('kendi açtığını, bağlantı 10 dk dönünce ve hattan inince kapatır', () {
    auto.onLine = true;
    auto.reachability(false, now);
    expect(decide(), AutoAction.start);
    // Durakta sinyal geldi ama hâlâ hattasın: açık kalır.
    auto.reachability(true, now += 60 * s);
    now += 11 * 60 * s;
    expect(decide(running: true, byAuto: true), AutoAction.none);
    // Hattan indin.
    auto.onLine = false;
    expect(decide(running: true, byAuto: true), AutoAction.stop);
    // Elle açılmış modu kapatmaz.
    expect(decide(running: true), AutoAction.none);
  });

  test('kullanıcı kapatınca bu yolculukta yeniden açılmaz; hattan inip bağlantı gelince yine çalışır', () {
    auto.onLine = true;
    auto.reachability(false, now);
    expect(decide(), AutoAction.start);
    auto.userStopped();
    now += 5 * 60 * s;
    expect(decide(), AutoAction.none);
    // Yolculuk bitti.
    auto.onLine = false;
    auto.reachability(true, now);
    expect(decide(), AutoAction.none);
    // Ertesi biniş.
    auto.onLine = true;
    expect(decide(), AutoAction.start);
  });

  test('kapalıyken hiçbir şey yapmaz', () {
    auto.enabled = false;
    auto.onLine = true;
    expect(decide(), AutoAction.none);
  });
}
