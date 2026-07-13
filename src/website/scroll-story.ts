import type { Object3D } from "three";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export function initializeScrollStory(product: Object3D): void {
  gsap.to(product.rotation, {
    y: Math.PI * 2,
    ease: "none",
    scrollTrigger: {
      trigger: "#story",
      start: "top top",
      end: "bottom bottom",
      scrub: true,
    },
  });
}
