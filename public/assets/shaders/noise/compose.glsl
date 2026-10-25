// Normal union XOR subtract parity, wobbled for active fields.
uniform sampler2D mask;
uniform sampler2D displaceMap;
uniform vec4 frame;
uniform float time;
uniform float wobble;
void main() {
  vec2 f = (uv - frame.xy) / frame.zw;
  vec3 d = displace(displaceMap, f * vec2(2.13, 1.02), time / 20.0 * 2.59);
  vec2 m = texture(mask, uv + d.xy * 0.1 * frame.zw * wobble).rg;
  o = vec4(abs(m.r - m.g), 0.0, 0.0, 1.0);
}
