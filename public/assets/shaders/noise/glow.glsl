// One dilation ring: r = dilated coverage, g = weighted glow outside, b = first ring (edge).
uniform sampler2D prev;
uniform sampler2D compose;
uniform vec2 texel;
uniform float weight;
uniform float first;
void main() {
  vec4 c = texture(prev, uv);
  float d = c.r;
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) d = max(d, texture(prev, uv + vec2(x, y) * texel).r);
  float inside = texture(compose, uv).r;
  float ring = clamp(d - c.r, 0.0, 1.0) * (1.0 - inside);
  float glow = clamp(ring * weight + c.g * (1.0 - first), 0.0, 1.0);
  float edge = first > 0.5 ? clamp(d - inside, 0.0, 1.0) : c.b;
  o = vec4(d, glow, edge, 1.0);
}
