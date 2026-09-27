// Pure orbit state. Model bounds supply the centre and radius in the rendering layer.
export function createInspect() {
  return {
    selected: null, target: [0, 0, 0], yaw: 0.8, pitch: 0.3, distance: 5,
    select(id, centre, radius) {
      this.selected = id;
      this.target = [...centre];
      this.distance = Math.max(1.2, radius * 2.8);
    },
    orbit(dx, dy, zoom = 0) {
      this.yaw += dx;
      this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch + dy));
      this.distance = Math.max(0.5, Math.min(180, this.distance * Math.exp(zoom)));
    },
    position() {
      return [this.target[0] + Math.cos(this.yaw) * Math.cos(this.pitch) * this.distance,
        this.target[1] + Math.sin(this.pitch) * this.distance,
        this.target[2] - Math.sin(this.yaw) * Math.cos(this.pitch) * this.distance];
    },
  };
}
