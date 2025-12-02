import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:image/image.dart' as img;
import 'package:path_provider/path_provider.dart';

void main() => runApp(const StickerConverterApp());

class StickerConverterApp extends StatelessWidget {
  const StickerConverterApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Sticker Converter',
      theme: ThemeData.dark(useMaterial3: true),
      home: const StickerHome(),
    );
  }
}

class StickerHome extends StatefulWidget {
  const StickerHome({super.key});
  @override
  State<StickerHome> createState() => _StickerHomeState();
}

class _StickerHomeState extends State<StickerHome> {
  static const targetSizeBytes = 100 * 1024; // 100KB
  static const targetDim = 512;

  List<PlatformFile> _picked = [];
  List<_Result> _results = [];
  bool _busy = false;
  String? _outputDirPath;

  Future<void> _pickImages() async {
    setState(() => _busy = true);
    try {
      final res = await FilePicker.platform.pickFiles(
        allowMultiple: true,
        type: FileType.image,
        withData: false,
      );
      if (res != null) {
        setState(() {
          _picked = res.files;
          _results = [];
          _outputDirPath = null;
        });
      }
    } catch (e) {
      _showSnack('Pick failed: $e');
    } finally {
      setState(() => _busy = false);
    }
  }

  Future<void> _convert() async {
    if (_picked.isEmpty) {
      _showSnack('Pick at least one image.');
      return;
    }
    setState(() {
      _busy = true;
      _results = [];
    });

    try {
      final docs = await getApplicationDocumentsDirectory();
      final outRoot = Directory(
        '${docs.path}/StickerConverter/packs/${DateTime.now().millisecondsSinceEpoch}',
      );
      await outRoot.create(recursive: true);
      _outputDirPath = outRoot.path;

      final results = <_Result>[];
      for (var i = 0; i < _picked.length; i++) {
        final f = _picked[i];
        if (f.path == null) {
          results.add(_Result(original: f.name, ok: false, message: 'No file path'));
          setState(() => _results = List<_Result>.from(results));
          continue;
        }
        try {
          final bytes = await File(f.path!).readAsBytes();
          final out = await _convertOne(bytes, f.name, outRoot, i);
          results.add(out);
        } catch (e) {
          results.add(_Result(original: f.name, ok: false, message: 'Error: $e'));
        }
        setState(() => _results = List<_Result>.from(results));
      }

      final okCount = results.where((r) => r.ok).length;
      _showSnack('Converted $okCount / ${results.length}. Output: $_outputDirPath');
    } finally {
      setState(() => _busy = false);
    }
  }

  Future<_Result> _convertOne(
    Uint8List input,
    String originalName,
    Directory outRoot,
    int index,
  ) async {
    final imgSrc = img.decodeImage(input);
    if (imgSrc == null) {
      return _Result(original: originalName, ok: false, message: 'Unsupported image');
    }

    // Resize with cover to 512x512 (center-crop)
    final resized = img.copyResizeCropSquare(imgSrc, size: targetDim);

    // Step down quality until <= 100KB (WebP)
    for (var quality = 90; quality >= 30; quality -= 10) {
      final webp = img.encodeWebP(resized, quality: quality);
      if (webp.lengthInBytes <= targetSizeBytes) {
        final outPath = '${outRoot.path}/sticker_${index + 1}.webp';
        await File(outPath).writeAsBytes(webp, flush: true);
        return _Result(
          original: originalName,
          ok: true,
          message: 'OK ($quality%)',
          outputPath: outPath,
        );
      }
    }

    // If still too big, try mild downscale (e.g. 480) and retry once
    final resized2 = img.copyResize(resized, width: 480, height: 480);
    for (var quality = 90; quality >= 20; quality -= 10) {
      final webp = img.encodeWebP(resized2, quality: quality);
      if (webp.lengthInBytes <= targetSizeBytes) {
        final outPath = '${outRoot.path}/sticker_${index + 1}.webp';
        await File(outPath).writeAsBytes(webp, flush: true);
        return _Result(
          original: originalName,
          ok: true,
          message: 'OK (480, $quality%)',
          outputPath: outPath,
        );
      }
    }

    return _Result(
      original: originalName,
      ok: false,
      message: 'Could not compress under 100KB',
    );
  }

  void _showSnack(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  @override
  Widget build(BuildContext context) {
    final canConvert = _picked.isNotEmpty && !_busy;

    return Scaffold(
      appBar: AppBar(title: const Text('Sticker Converter (Flutter)')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Row(
              children: [
                ElevatedButton.icon(
                  onPressed: _busy ? null : _pickImages,
                  icon: const Icon(Icons.photo_library),
                  label: const Text('Pick Images'),
                ),
                const SizedBox(width: 12),
                ElevatedButton.icon(
                  onPressed: canConvert ? _convert : null,
                  icon: const Icon(Icons.transform),
                  label: const Text('Convert to WhatsApp'),
                ),
              ],
            ),
            if (_outputDirPath != null) ...[
              const SizedBox(height: 8),
              Text('Output: $_outputDirPath', style: const TextStyle(fontSize: 12)),
            ],
            const SizedBox(height: 12),
            Expanded(
              child: _busy
                  ? const Center(child: CircularProgressIndicator())
                  : _results.isEmpty
                      ? _picked.isEmpty
                          ? const Center(child: Text('Pick images to begin'))
                          : _PickedList(picked: _picked)
                      : _ResultsList(results: _results),
            ),
          ],
        ),
      ),
    );
  }
}

class _PickedList extends StatelessWidget {
  const _PickedList({required this.picked});
  final List<PlatformFile> picked;

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      itemCount: picked.length,
      separatorBuilder: (_, __) => const Divider(height: 1),
      itemBuilder: (_, i) {
        final p = picked[i];
        return ListTile(
          leading: const Icon(Icons.image),
          title: Text(p.name),
          subtitle: Text(p.path ?? ''),
        );
      },
    );
  }
}

class _ResultsList extends StatelessWidget {
  const _ResultsList({required this.results});
  final List<_Result> results;

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      itemCount: results.length,
      separatorBuilder: (_, __) => const Divider(height: 1),
      itemBuilder: (_, i) {
        final r = results[i];
        return ListTile(
          leading: Icon(r.ok ? Icons.check_circle : Icons.error, color: r.ok ? Colors.green : Colors.red),
          title: Text(r.original),
          subtitle: Text(r.message ?? ''),
          trailing: r.outputPath != null ? const Icon(Icons.insert_drive_file) : null,
        );
      },
    );
  }
}

class _Result {
  _Result({required this.original, required this.ok, this.message, this.outputPath});
  final String original;
  final bool ok;
  final String? message;
  final String? outputPath;
}

