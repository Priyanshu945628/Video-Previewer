import { auth } from '@/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from '@vsp/ui';

export const metadata = { title: 'Profile' };

export default async function ProfilePage() {
  const session = await auth();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>How you appear to clients and teammates.</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" defaultValue={session?.user?.name ?? ''} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" defaultValue={session?.user?.email ?? ''} disabled />
        </div>
      </CardContent>
    </Card>
  );
}
