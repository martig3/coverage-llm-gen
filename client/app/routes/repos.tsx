import { Link, useRevalidator } from 'react-router';
import { Card, CardTitle } from '~/components/ui/card';
import { ChevronRightIcon, Loader2, PlusIcon } from 'lucide-react';
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemActions,
} from '~/components/ui/item';
import type { Route } from './+types/repos';
import { API_BASE_URL } from '~/lib/base-url';
import { Input } from '~/components/ui/input';
import { Button } from '~/components/ui/button';
import { useState } from 'react';

export async function clientLoader() {
  const repos = (await (await fetch(`${API_BASE_URL}/repo`)).json()) as {
    id: string;
    url: string;
  }[];
  return { repos };
}

export default function Repos({ loaderData }: Route.ComponentProps) {
  const { repos } = loaderData;
  const revalidator = useRevalidator();
  const [addingRepo, setAddingRepo] = useState(false);
  const [repoUrl, setRepoUrl] = useState('');
  const addRepo = async (url: string) => {
    setAddingRepo(true);
    try {
      await fetch(`${API_BASE_URL}/repo/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
      });
    } catch {
      setAddingRepo(false);
      return;
    }
    setAddingRepo(false);
    setRepoUrl('');
    await revalidator.revalidate();
  };
  return (
    <Card className="p-8 min-w-lg">
      <CardTitle>Repositories</CardTitle>
      <div className="flex flex-row gap-2">
        <Input
          type="text"
          placeholder="GitHub Repository URL"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
        />
        <Button disabled={addingRepo} onClick={() => void addRepo(repoUrl)}>
          {addingRepo ? <Loader2 className="animate-spin" /> : <PlusIcon />}
        </Button>
      </div>
      {repos.map((r) => (
        <Item variant="outline" size="sm" key={r.id} asChild>
          <Link to={`/repo/${r.id}/files`}>
            <ItemContent>
              <ItemTitle>{r.url}</ItemTitle>
            </ItemContent>
            <ItemActions>
              <ChevronRightIcon className="size-4" />
            </ItemActions>
          </Link>
        </Item>
      ))}
    </Card>
  );
}
