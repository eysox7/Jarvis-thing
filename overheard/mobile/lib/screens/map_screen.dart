import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../app/app.dart';
import '../app/controller.dart';
import '../core/models.dart';
import '../l10n/strings.dart';
import 'compose_sheet.dart';
import 'overheard_sheet.dart';

// Şehir haritası: mekânlar, hatlar ve söz balonları. Kilitli (yerel) sözlerin metni gelmez.
class MapScreen extends StatefulWidget {
  const MapScreen({super.key});

  @override
  State<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends State<MapScreen> {
  final _map = MapController();
  bool _checking = false;

  void _snack(String text) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));

  Future<void> _checkIn() async {
    final app = AppScope.read(context);
    setState(() => _checking = true);
    try {
      final presence = await app.checkIn();
      final fresh = presence.places.where((p) => !p.held).toList();
      if (presence.blocked != null) {
        _snack(errorText(presence.blocked!));
      } else if (fresh.isNotEmpty) {
        _snack(t('map.checkedIn', {'place': fresh.map((p) => p.name).join(', ')}));
      } else if (presence.places.isNotEmpty) {
        _snack(t('map.held', {'place': presence.places.first.name}));
      } else {
        _snack(t('map.nowhere'));
      }
      final fix = app.lastFix;
      if (fix != null) _map.move(LatLng(fix.lat, fix.lng), 16);
    } on NoLocation {
      _snack(t('map.noLocation'));
    } catch (e) {
      _snack(errorText(e));
    } finally {
      if (mounted) setState(() => _checking = false);
    }
  }

  void _pickCity(City city) {
    AppScope.read(context).loadCity(city.id).catchError((Object e) => _snack(errorText(e)));
    _map.move(LatLng(city.lat, city.lng), city.zoom);
  }

  static Color _lineColor(String? hex) {
    final value = int.tryParse((hex ?? '').replaceFirst('#', ''), radix: 16);
    return value == null ? accent : Color(0xFF000000 | value);
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final city = app.city;
    final map = app.map;
    final places = map?.places ?? const <Place>[];
    final overheards = map?.overheards ?? const <Overheard>[];
    final theme = Theme.of(context);
    return Scaffold(
      body: Stack(
        children: [
          FlutterMap(
            mapController: _map,
            options: MapOptions(initialCenter: LatLng(city.lat, city.lng), initialZoom: city.zoom),
            children: [
              TileLayer(
                urlTemplate: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
                subdomains: const ['a', 'b', 'c', 'd'],
                retinaMode: MediaQuery.devicePixelRatioOf(context) > 1.5,
                userAgentPackageName: 'app.overheard',
              ),
              PolylineLayer(
                polylines: [
                  for (final p in places.where((p) => p.line && p.stops.length > 1))
                    Polyline(
                      points: [for (final s in p.stops) LatLng(s[0], s[1])],
                      color: _lineColor(p.color).withValues(alpha: 0.8),
                      strokeWidth: p.here ? 7 : 4,
                    ),
                ],
              ),
              CircleLayer(
                circles: [
                  for (final p in places.where((p) => !p.line && p.count > 0))
                    CircleMarker(
                      point: LatLng(p.lat, p.lng),
                      radius: p.radius,
                      useRadiusInMeter: true,
                      color: (p.here ? accent : lockedColor).withValues(alpha: 0.14),
                      borderColor: (p.here ? accent : lockedColor).withValues(alpha: 0.5),
                      borderStrokeWidth: 1.5,
                    ),
                ],
              ),
              MarkerLayer(
                markers: [
                  for (final o in overheards)
                    Marker(
                      point: LatLng(o.lat, o.lng),
                      width: 40,
                      height: 40,
                      child: _Bubble(overheard: o, onTap: () => showOverheard(context, o)),
                    ),
                ],
              ),
              const RichAttributionWidget(
                attributions: [TextSourceAttribution('OpenStreetMap contributors'), TextSourceAttribution('CARTO')],
              ),
            ],
          ),
          SafeArea(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SizedBox(
                  height: 52,
                  child: ListView(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    children: [
                      for (final c in app.cities)
                        Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: ChoiceChip(
                            label: Text(c.name),
                            selected: c.id == city.id,
                            onSelected: (_) => _pickCity(c),
                          ),
                        ),
                    ],
                  ),
                ),
                if (app.mapStale)
                  Container(
                    margin: const EdgeInsets.symmetric(horizontal: 12),
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surface,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text('📡 ${t('map.offline')}', style: theme.textTheme.bodySmall),
                  ),
              ],
            ),
          ),
        ],
      ),
      floatingActionButton: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          FloatingActionButton.extended(
            heroTag: 'here',
            onPressed: _checking ? null : _checkIn,
            backgroundColor: theme.colorScheme.surface,
            foregroundColor: theme.colorScheme.onSurface,
            icon: _checking
                ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.my_location),
            label: Text(t('map.here')),
          ),
          const SizedBox(height: 12),
          FloatingActionButton.extended(
            heroTag: 'compose',
            onPressed: () => showCompose(context),
            icon: const Icon(Icons.hearing),
            label: Text(t('map.compose')),
          ),
        ],
      ),
    );
  }
}

// Söz balonu: açık sözler turuncu, kilitliler gri; internetsiz yazılmışlar 📡 ile işaretli.
class _Bubble extends StatelessWidget {
  const _Bubble({required this.overheard, required this.onTap});

  final Overheard overheard;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = overheard.locked ? lockedColor : accent;
    return GestureDetector(
      onTap: onTap,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Container(
            decoration: BoxDecoration(
              color: color,
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white, width: 2),
              boxShadow: const [BoxShadow(color: Color(0x33140E1E), blurRadius: 6, offset: Offset(0, 2))],
            ),
            alignment: Alignment.center,
            child: Text(overheard.locked ? '🔒' : '💬', style: const TextStyle(fontSize: 16)),
          ),
          if (overheard.offline)
            const Positioned(right: -4, top: -4, child: Text('📡', style: TextStyle(fontSize: 14))),
        ],
      ),
    );
  }
}
