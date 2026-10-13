import type { Metadata } from "next";
import { Alerts } from "./alerts";

export const metadata: Metadata = {
  title: "Graded-card price alerts",
  description: "Set buying and selling targets for graded trading cards. Record prices and keep your alerts on this device.",
};

export default function AlertsPage() {
  return <Alerts />;
}
