import { t } from './i18n.js';
import { cssVar } from './maps/common.js';

// Herkese açık bir sözden Instagram hikâyesi boyutunda (1080×1920) paylaşım görseli üretir.
// Yazarın adı görselde yer almaz: overheard geleneğinde söz yalnızca yeriyle anılır.
const W = 1080;
const H = 1920;

function wrap(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function renderShareCard(o, cityName) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const accent = cssVar('--accent') || '#ff5a3c';
  const serif = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
  const sans = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

  ctx.fillStyle = '#f4f1ea';
  ctx.fillRect(0, 0, W, H);

  // Metni sığdırmak için yazı boyutunu küçültür.
  let size = 84;
  let lines;
  do {
    ctx.font = `italic 700 ${size}px ${serif}`;
    lines = wrap(ctx, `“${o.text}”`, W - 280);
    size -= 4;
  } while (lines.length * size * 1.3 > 900 && size > 44);
  const lineHeight = (size + 4) * 1.3;
  const bubbleH = lines.length * lineHeight + 180;
  const bubbleY = Math.max(380, (H - bubbleH) / 2 - 80);

  // Konuşma balonu ve kuyruğu.
  ctx.fillStyle = '#fffaf0';
  ctx.strokeStyle = accent;
  ctx.lineWidth = 10;
  roundRect(ctx, 80, bubbleY, W - 160, bubbleH, 64);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(W / 2 - 60, bubbleY + bubbleH - 5);
  ctx.lineTo(W / 2, bubbleY + bubbleH + 90);
  ctx.lineTo(W / 2 + 60, bubbleY + bubbleH - 5);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(W / 2 - 60, bubbleY + bubbleH);
  ctx.lineTo(W / 2, bubbleY + bubbleH + 90);
  ctx.lineTo(W / 2 + 60, bubbleY + bubbleH);
  ctx.stroke();

  ctx.fillStyle = '#1d1a22';
  ctx.font = `italic 700 ${size + 4}px ${serif}`;
  ctx.textBaseline = 'top';
  lines.forEach((line, i) => ctx.fillText(line, 140, bubbleY + 90 + i * lineHeight));

  // Yer ve marka.
  ctx.textAlign = 'center';
  ctx.fillStyle = '#6d6676';
  ctx.font = `600 46px ${sans}`;
  ctx.fillText(`📍 ${o.placeName}${cityName ? `, ${cityName}` : ''}`, W / 2, bubbleY + bubbleH + 150);

  ctx.fillStyle = accent;
  ctx.font = `700 150px ${serif}`;
  ctx.fillText('“', W / 2 - 250, 150);
  ctx.fillStyle = '#1d1a22';
  ctx.font = `800 96px ${sans}`;
  ctx.fillText('overheard', W / 2 + 40, 170);

  ctx.fillStyle = '#6d6676';
  ctx.font = `500 40px ${sans}`;
  ctx.fillText(t('share.footer'), W / 2, H - 170);
  return canvas;
}

const toBlob = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

// Telefonda sistem paylaşım menüsünü açar; desteklenmiyorsa görseli indirir.
export async function shareOverheard(o, cityName) {
  const blob = await toBlob(renderShareCard(o, cityName));
  const file = new File([blob], 'overheard.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: `“${o.text}” — ${o.placeName} #overheard` });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: 'overheard.png' });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}
