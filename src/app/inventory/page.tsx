import type { Metadata } from "next";
import { Inventory } from "./inventory";

export const metadata: Metadata = {
  title: "Your portfolio",
  description: "Keep track of Counter-Strike skins, books and the collectibles you care about. Saved on your device.",
};

export default function InventoryPage() {
  return <Inventory />;
}
