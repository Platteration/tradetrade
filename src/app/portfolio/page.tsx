import type { Metadata } from "next";
import { Portfolio } from "./portfolio";

export const metadata: Metadata = {
  title: "Your collection",
  description: "Keep track of your trading cards, binders, and the little details. Saved on your device.",
};

export default function PortfolioPage() {
  return <Portfolio />;
}
