import { LoginForm } from './login-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@vsp/ui';

export const metadata = { title: 'Sign in' };

export default function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string; error?: string };
}) {
  return (
    <Card className="border-border/60 backdrop-blur-xl">
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          VSP
        </div>
        <CardTitle className="text-2xl">Welcome back</CardTitle>
        <CardDescription>Sign in to review the work in progress.</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm next={searchParams.next} error={searchParams.error} />
      </CardContent>
    </Card>
  );
}
