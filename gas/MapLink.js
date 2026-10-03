// Googleマップの共有リンクから、場所名と位置を読み取る。
// 短縮URL（maps.app.goo.gl など）はリダイレクトを1つずつたどる。Google マップ以外のURLは読みに行かない。
// 読み取りの順：URL の中（!3d…!4d… ＞ q= の座標 ＞ @緯度,経度）→ q= の住所をジオコーダーで位置に →
// ページの中（og:title・地図画像の center。場所のページのときだけ。検索のページの center はサーバーの場所なので使わない）
// スマホの共有リンクはたいてい q=「〒郵便番号 住所 ビル 階 店名」で、URL にもページにも位置が無い

const MAP_LINK_MAX_HOPS = 6;

function apiResolveMapLink_(req) {
  auth_(req.token); // アルバムのメンバーだけが使える
  const found = String(req.url || '').match(/https?:\/\/[^\s<>"]+/);
  if (!found) throw apiError_('invalid', 'Googleマップのリンクが見つかりません');
  let url = found[0];
  let html = '';
  for (let i = 0; i < MAP_LINK_MAX_HOPS; i++) {
    if (!isMapUrl_(url)) throw apiError_('invalid', 'Googleマップのリンクではありません');
    const res = UrlFetchApp.fetch(url, {
      followRedirects: false,
      muteHttpExceptions: true,
      headers: { 'Accept-Language': 'ja' }
    });
    const code = res.getResponseCode();
    const headers = res.getAllHeaders();
    const loc = headers.Location || headers.location;
    if (code >= 300 && code < 400 && loc) {
      url = loc.charAt(0) === '/' ? url.match(/^https?:\/\/[^\/?#]+/)[0] + loc : loc;
      continue;
    }
    if (code === 200) html = res.getContentText();
    break;
  }
  const info = parseMapUrl_(url);
  if (info.lat == null && info.query) {
    const ll = geocode_(info.address) || geocode_(info.query);
    if (ll) { info.lat = ll.lat; info.lng = ll.lng; }
  }
  if (html) {
    const page = parseMapHtml_(html);
    if (!info.place_name) info.place_name = page.place_name;
    if (!info.address) info.address = page.address;
    if (info.lat == null) { info.lat = page.lat; info.lng = page.lng; }
  }
  if (info.lat == null) throw apiError_('not_found', '位置を読み取れませんでした。地図をタップして指定してください');
  return {
    place_name: (info.place_name || '').slice(0, 100),
    address: (info.address || '').slice(0, 200),
    lat: info.lat,
    lng: info.lng
  };
}

function isMapUrl_(url) {
  const m = String(url).match(/^https:\/\/([^\/?#:]+)(\/[^?#]*)?/i);
  if (!m) return false;
  const host = m[1].toLowerCase();
  const path = m[2] || '/';
  if (host === 'maps.app.goo.gl') return true;
  if (host === 'goo.gl') return path.indexOf('/maps') === 0;
  if (/^maps\.google\.(com|co\.jp)$/.test(host)) return true;
  if (/^(www\.)?google\.(com|co\.jp)$/.test(host)) return path.indexOf('/maps') === 0;
  return false;
}

// 緯度経度として正しければ {lat, lng}
function latLng_(a, b) {
  const lat = Number(a);
  const lng = Number(b);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat: lat, lng: lng };
}

function decodeMapText_(s) {
  try { s = decodeURIComponent(String(s).replace(/\+/g, ' ')); } catch (e) { s = String(s).replace(/\+/g, ' '); }
  return s.trim();
}

const COORD_TEXT_ = /^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/;

// Apps Script の Maps サービスで住所→位置（APIキー不要）。見つからなければ null
function geocode_(text) {
  if (!text) return null;
  try {
    const r = Maps.newGeocoder().setRegion('jp').setLanguage('ja').geocode(text);
    const loc = r && r.status === 'OK' && r.results[0] && r.results[0].geometry.location;
    return loc ? latLng_(loc.lat, loc.lng) : null;
  } catch (e) {
    console.warn('geocode failed: ' + e);
    return null;
  }
}

// 「〒160-0023 東京都新宿区西新宿１丁目１−５ ルミネ新宿1 4階 店名 支店」を住所と店名に分ける。
// 住所＝郵便番号と、そのあとの数字を含む最初のかたまり。階（4階・2F・B1F など）があれば、そこまでがビルの情報
function splitJpQuery_(q) {
  const tokens = q.split(/[ \u3000]+/).filter(Boolean);
  if (!tokens.length || !/^〒?\d{3}-?\d{4}$/.test(tokens[0].replace(/[０-９－]/g, function (c) { return c === '－' ? '-' : String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }))) return null;
  let i = 1;
  const addr = [tokens[0]];
  while (i < tokens.length) {
    addr.push(tokens[i]);
    if (/[0-9０-９]/.test(tokens[i++])) break;
  }
  let rest = tokens.slice(i);
  let lastFloor = -1;
  rest.forEach(function (t, k) { if (/^(地下)?[BＢ]?[0-9０-９]+(階|[FＦ])$/i.test(t)) lastFloor = k; });
  if (lastFloor >= 0) rest = rest.slice(lastFloor + 1);
  return { address: addr.join(' '), name: rest.join(' ') };
}

function parseMapUrl_(url) {
  const info = { place_name: '', address: '', query: '', lat: null, lng: null };
  const ll = (function () {
    let m = url.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
    if (m) return latLng_(m[1], m[2]);
    m = url.match(/[?&](?:q|query|ll|center|destination)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(?:\+|%20)?(-?\d+(?:\.\d+)?)/i);
    if (m) return latLng_(m[1], m[2]);
    m = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (m) return latLng_(m[1], m[2]);
    return null;
  })();
  if (ll) { info.lat = ll.lat; info.lng = ll.lng; }

  let m = url.match(/\/maps\/place\/([^\/@?#]+)/);
  if (m) {
    const name = decodeMapText_(m[1]);
    if (!COORD_TEXT_.test(name)) info.place_name = name;
  }
  if (!info.place_name) {
    m = url.match(/[?&](?:q|query)=([^&#]+)/);
    if (m) {
      const q = decodeMapText_(m[1]);
      if (!COORD_TEXT_.test(q)) {
        info.query = q;
        const jp = splitJpQuery_(q);
        if (jp) {
          info.place_name = jp.name;
          info.address = jp.address;
        } else {
          // 「店名, 住所」の形なら、最初の区切りまでを場所名にする
          const parts = q.split(/,\s*|、/);
          info.place_name = parts[0];
          info.address = parts.slice(1).join(', ');
        }
      }
    }
  }
  return info;
}

function decodeHtml_(s) {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); });
}

function metaContent_(html, prop) {
  const m = html.match(new RegExp('<meta[^>]+(?:property|name|itemprop)="' + prop + '"[^>]*>', 'i'));
  if (!m) return '';
  const c = m[0].match(/content="([^"]*)"/i);
  return c ? decodeHtml_(c[1]).trim() : '';
}

function parseMapHtml_(html) {
  const info = { place_name: '', address: '', lat: null, lng: null };
  // og:title は「店名 · 住所」。「Google マップ」だけのときは使わない
  const title = metaContent_(html, 'og:title');
  if (!title || /^google\s*(マップ|maps)$/i.test(title)) return info; // 検索のページ（位置はあてにならない）
  const parts = title.split(' · ');
  info.place_name = parts[0];
  info.address = parts.slice(1).join(' · ');
  // 地図画像（og:image）の center／markers に位置が入っている
  const image = metaContent_(html, 'og:image');
  let m = image.match(/(?:center|markers)=(-?\d+(?:\.\d+)?)(?:%2C|,)(-?\d+(?:\.\d+)?)/i);
  let ll = m ? latLng_(m[1], m[2]) : null;
  if (!ll) {
    // ページの初期状態 [[[ズーム, 経度, 緯度]
    m = html.match(/APP_INITIALIZATION_STATE=\[\[\[[\d.]+,(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\]/);
    if (m) ll = latLng_(m[2], m[1]);
  }
  if (ll) { info.lat = ll.lat; info.lng = ll.lng; }
  return info;
}
