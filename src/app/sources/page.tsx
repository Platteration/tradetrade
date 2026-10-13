import type { Metadata } from "next";
import { Sources } from "./sources";

export const metadata: Metadata = {
  title: "Website sources",
  description: "Save websites for the collectibles you follow and record prices manually on your device.",
};

export default function SourcesPage() {
  return <Sources />;
}
