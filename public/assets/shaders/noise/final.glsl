uniform sampler2D scene;
uniform sampler2D activeMask;
uniform sampler2D readyMask;
uniform sampler2D disabledMask;
uniform sampler2D effect;
uniform sampler2D displaceMap;
uniform sampler2D sparkMap;
uniform sampler2D colorMap;
uniform float colored;
uniform vec2 screen;
uniform vec2 effectSize;
uniform vec4 frame;
uniform float unit;
uniform float time;

const vec3 FILL = vec3(0.713, 0.235, 0.235);
const vec3 EDGE = vec3(1.0, 0.330, 0.330);
const vec3 GLOW = vec3(1.0, 0.179, 0.179);
const vec3 SPARK = vec3(1.0, 0.285, 0.285);
const vec3 DISABLED_FILL = vec3(0.497, 0.138, 0.138);
const vec3 DISABLED_SPARK = vec3(0.311, 0.078, 0.078);
const vec3 RED = vec3(1.0, 84.0 / 255.0, 84.0 / 255.0);

// Field tint at uv (premultiplied by coverage, so divide).
vec3 tintAt(vec2 p) {
  if (colored < 0.5) return RED;
  vec4 c = texture(colorMap, p);
  return c.a > 0.001 ? c.rgb / c.a : RED;
}

// Moves a native red shade to rgb's hue, keeping its value and saturation (Phira).
vec3 palette(vec3 native, vec3 rgb) {
  if (all(lessThan(abs(rgb - RED), vec3(0.001)))) return native;
  float high = max(rgb.r, max(rgb.g, rgb.b));
  float low = min(rgb.r, min(rgb.g, rgb.b));
  float delta = high - low;
  if (delta < 0.00001) return vec3(native.r * high);
  vec3 hue = (rgb - low) / delta;
  float sat = (1.0 - native.g / max(native.r, 0.00001)) * (delta / max(high, 0.00001)) / (1.0 - 84.0 / 255.0);
  return native.r * high * mix(vec3(1.0), hue, clamp(sat, 0.0, 1.0));
}

vec3 rgb2hsv(vec3 c) {
  vec4 k = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, k.wz), vec4(c.gb, k.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec3 p = clamp(abs(fract(c.x + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return c.z * mix(vec3(1.0), p, c.y);
}

vec3 overlay(vec3 base, vec3 blend) {
  vec3 lo = 2.0 * base * blend;
  vec3 hi = 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
  return clamp(mix(lo, hi, step(0.5, base)), 0.0, 1.0);
}

void main() {
  vec4 base = texture(scene, uv);
  vec2 f = (uv - frame.xy) / frame.zw;
  float covered = texture(activeMask, uv).r;
  float ready = texture(readyMask, uv).r;
  float disabled = texture(disabledMask, uv).r * (1.0 - covered) * (1.0 - ready);
  vec3 rgb = tintAt(uv);

  // Disabled: dim fill with faint sparks, added on top.
  if (disabled > 0.0) {
    vec3 d = displace(displaceMap, f * vec2(0.5, 0.2), time / 20.0 * 0.3);
    float spark = texture(sparkMap, f * vec2(3.0, 1.2) + d.xy * 2.29).r;
    vec3 add = palette(DISABLED_FILL, rgb) * 0.4 + spark * palette(DISABLED_SPARK, rgb) * d.z * 3.5;
    base = vec4(base.rgb + add * disabled, max(base.a, disabled));
  }

  float edge = texture(effect, (floor(uv * effectSize) + 0.5) / effectSize).b;
  float glow = texture(effect, uv).g;
  float body = covered + edge;
  vec3 color = vec3(0.0);
  float alpha = 0.0;
  if (body + glow > 1e-4) {
    // Pixelated, displaced scene behind the fill.
    vec2 px = 6.0 * unit / screen;
    vec2 cell = (floor(uv / px) + 0.5) * px;
    vec2 cf = (cell - frame.xy) / frame.zw;
    vec3 d = displace(displaceMap, cf * vec2(0.8, 0.3), time / 20.0 * 1.5);
    vec3 sc = texture(scene, cell + d.xy * 0.15 * frame.zw).rgb;
    float spark = texture(sparkMap, f * vec2(3.0, 1.2) + d.xy * 2.39).r;
    vec3 sparks = spark * palette(SPARK, rgb) * d.z * 5.69;
    vec3 hsv = rgb2hsv(sc) + sparks * 0.2;
    vec3 tinted = overlay(hsv2rgb(hsv), sparks);
    vec3 fill = mix(palette(FILL - d.z * 0.411, rgb), tinted, 0.667);
    float halo = glow * (1.0 - body);
    color = fill * covered + palette(EDGE, rgb) * edge * 0.8 + palette(GLOW, rgb) * halo * 0.8;
    alpha = covered * 0.667 + edge * 0.8 + halo * 0.8;
  }
  // Ready: flickering shine.
  color += vec3(0.12) * (sin(time * 37.9) * 0.5 + 1.0) * ready * ready;

  vec4 outc = vec4(color + base.rgb * (1.0 - alpha), alpha + base.a * (1.0 - alpha));
  o = vec4(min(outc.rgb, vec3(outc.a)), clamp(outc.a, 0.0, 1.0));
}
