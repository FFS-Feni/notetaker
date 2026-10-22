import { ActionIcon, AppShell, Badge, Burger, Button, Group, Indicator, NavLink as MNavLink, Popover, ScrollArea, Stack, Text, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router";
import { api, type AppNotification } from "../api";
import { useApp } from "../context";
import { useRealtime } from "../realtime";
import { fmt } from "../time";

const LINKS = [
  ["/calendar", "Календарь"],
  ["/notes", "Список"],
  ["/upcoming", "Ближайшее"],
  ["/matrix", "Матрица"],
  ["/trash", "Корзина"],
  ["/tags", "Теги"],
  ["/settings", "Настройки"],
] as const;

export function Layout({ children }: { children: ReactNode }) {
  const { user } = useApp();
  const qc = useQueryClient();
  const [opened, { toggle, close }] = useDisclosure();
  const { pathname } = useLocation();
  const shownHere = useRef(new Set<number>());

  // Всплывает в момент срабатывания во всех открытых вкладках; «показано» — чтобы после F5 не всплыло снова.
  const show = (n: AppNotification) => {
    if (shownHere.current.has(n.id)) return;
    shownHere.current.add(n.id);
    notifications.show({
      id: `n${n.id}`,
      title: n.title,
      message: n.body,
      color: n.kind === "missed" ? "orange" : "pink",
      autoClose: 20_000,
    });
    api(`/notifications/${n.id}/shown`, { method: "POST" }).catch(() => {});
  };
  const online = useRealtime(show);

  // Сработавшие, пока вкладок не было: показать один раз при открытии.
  useEffect(() => {
    api<AppNotification[]>("/notifications", { params: { unshown: true } }).then((list) => list.reverse().forEach(show));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recent = useQuery({ queryKey: ["notifications"], queryFn: () => api<AppNotification[]>("/notifications") });
  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    qc.clear();
    location.href = "/";
  };

  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 200, breakpoint: "sm", collapsed: { mobile: !opened } }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Title order={4}>Notetaker</Title>
            <Badge color={online ? "teal" : "red"} variant="light" title="Живые обновления между вкладками">
              {online ? "онлайн" : "нет связи"}
            </Badge>
          </Group>
          <Group gap="sm" wrap="nowrap">
            <Popover width={320} position="bottom-end" shadow="md">
              <Popover.Target>
                <Indicator disabled={!recent.data?.some((n) => !n.shown_at)} size={8}>
                  <ActionIcon variant="default" aria-label="Уведомления">🔔</ActionIcon>
                </Indicator>
              </Popover.Target>
              <Popover.Dropdown>
                <ScrollArea.Autosize mah={360}>
                  <Stack gap="xs">
                    {(recent.data ?? []).length === 0 && <Text size="sm" c="dimmed">Уведомлений пока нет. Они появятся, когда сработает напоминание.</Text>}
                    {(recent.data ?? []).slice(0, 15).map((n) => (
                      <div key={n.id}>
                        <Text size="sm" fw={600}>{n.title}</Text>
                        <Text size="xs" c="dimmed">{n.body} · {n.fired_at && fmt(n.fired_at, user.timezone, "dd.MM HH:mm")}</Text>
                      </div>
                    ))}
                  </Stack>
                </ScrollArea.Autosize>
              </Popover.Dropdown>
            </Popover>
            <Text size="sm" c="dimmed" visibleFrom="sm">{user.email}</Text>
            <Button size="xs" variant="default" onClick={logout} visibleFrom="sm">Выйти</Button>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs">
        {LINKS.map(([to, label]) => (
          <MNavLink key={to} component={NavLink} to={to} label={label} active={pathname.startsWith(to)} onClick={close} />
        ))}
        <Stack gap={4} mt="auto" hiddenFrom="sm">
          <Text size="xs" c="dimmed" px="sm">{user.email}</Text>
          <MNavLink label="Выйти" onClick={logout} />
        </Stack>
      </AppShell.Navbar>
      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
}
