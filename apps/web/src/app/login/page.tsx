import { AuthScreen } from "@/features/auth";

export const metadata = { title: "Sign in · Media" };

export default function Page() {
  return <AuthScreen mode="login" />;
}
