// Two lookups scrolling along DIR and its normal: xy = offset, z = average.
const vec2 DIR = vec2(0.70710678);
vec3 displace(sampler2D map, vec2 p, float shift) {
  vec2 n = vec2(-DIR.y, DIR.x);
  float a = texture(map, p + DIR * shift).r;
  float b = texture(map, p + n * shift).r;
  return vec3(DIR * (a - 0.5) + n * (b - 0.5), (a + b) * 0.5);
}
