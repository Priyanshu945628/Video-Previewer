import { SignupForm } from './signup-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@vsp/ui';

export const metadata = { title: 'Create your workspace' };

export default function SignupPage() {
  return (
    <Card className="border-border/60 backdrop-blur-xl">
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          VSP
        </div>
        <CardTitle className="text-2xl">Create your workspace</CardTitle>
        <CardDescription>It takes a minute. No credit card.</CardDescription>
      </CardHeader>
      <CardContent>
        <SignupForm />
      </CardContent>
    </Card>
  );
}
