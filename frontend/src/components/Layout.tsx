import {
  ActionIcon,
  AppShell,
  Badge,
  Burger,
  Button,
  Group,
  Indicator,
  Kbd,
  NavLink as MNavLink,
  Popover,
  ScrollArea,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import { useDisclosure, useHotkeys } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { useEffect, useRef, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router";
import { api, type AppNotification, type TrashItem, type Upcoming } from "../api";
import { useApp } from "../context";
import { useRealtime } from "../realtime";
import { fmt } from "../time";
import { Icon, type IconName } from "./icons";
import { QuickAdd } from "./QuickAdd";

type Link = { to: string; label: string; icon: IconName; count?: number; alert?: boolean };

export function Layout({ children }: { children: ReactNode }) {
  const { user, openEditor } = useApp();
  const qc = useQueryClient();
  const [opened, { toggle, close }] = useDisclosure();
  const { pathname } = useLocation();
  const shownHere = useRef(new Set<number>());

  // Всплывает в момент срабатывания во всех открытых вкладках; «показано» — чтобы после F5 не всплыло снова.
  const show = (n: AppNotification) => {
    if (shownHere.current.has(n.id)) return;
    shownHere.current.add(n.id);
    // Всплывающие можно выключить в настройках; «показано» отмечаем всё равно — чтобы не всплыли пачкой потом.
    if (user.prefs.popup_reminders)
      notifications.show({
        id: `n${n.id}`,
        title: n.title,
        message: n.kind === "reminder" ? <ReminderActions n={n} tz={user.timezone} /> : n.body,
        color: n.kind === "missed" ? "orange" : "indigo",
        icon: <Icon name="bell" size={16} />,
        autoClose: 30_000,
      });
    api(`/notifications/${n.id}/shown`, { method: "POST" }).catch(() => {});
  };
  // Отложили или отметили «готово» в другой вкладке — уведомление закрывается и здесь.
  const online = useRealtime(show, (id) => notifications.hide(`n${id}`));

  // Сработавшие, пока вкладок не было: показать один раз при открытии.
  useEffect(() => {
    api<AppNotification[]>("/notifications", { params: { unshown: true } }).then((list) => list.reverse().forEach(show));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // N — новая заметка с любого экрана (в полях ввода не срабатывает).
  useHotkeys([["n", () => openEditor({ kind: "new" })]]);

  const recent = useQuery({ queryKey: ["notifications"], queryFn: () => api<AppNotification[]>("/notifications") });
  // Счётчики в меню — те же данные, что на экранах (общий кэш, обновляются по событиям).
  const upcoming = useQuery({ queryKey: ["upcoming"], queryFn: () => api<Upcoming>("/upcoming"), refetchInterval: 60_000 });
  const trash = useQuery({ queryKey: ["trash"], queryFn: () => api<TrashItem[]>("/trash") });
  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    qc.clear();
    location.href = "/";
  };

  const groups: [string, Link[]][] = [
    [
      "Планирование",
      [
        { to: "/upcoming", label: "Ближайшее", icon: "sun", count: upcoming.data?.today.length, alert: !!upcoming.data?.past.length },
        { to: "/calendar", label: "Календарь", icon: "calendar" },
        ...(user.prefs.priorities ? [{ to: "/tasks", label: "Задачи", icon: "matrix" as const }] : []),
      ],
    ],
    [
      "Заметки",
      [
        { to: "/notes", label: "Список", icon: "list" },
        { to: "/tags", label: "Цвета и теги", icon: "tag" },
        { to: "/trash", label: "Корзина", icon: "trash", count: trash.data?.length },
      ],
    ],
    ["", [{ to: "/settings", label: "Настройки", icon: "settings" }]],
  ];

  return (
    <AppShell header={{ height: 60 }} navbar={{ width: 230, breakpoint: "sm", collapsed: { mobile: !opened } }} padding="lg">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Меню" />
            <ThemeIcon size={32} radius="md" variant="gradient" gradient={{ from: "indigo", to: "cyan", deg: 135 }}>
              <Icon name="check" size={18} stroke={2.4} />
            </ThemeIcon>
            <Text fw={800} size="lg" visibleFrom="xs">Notetaker</Text>
            <Tooltip label={online ? "Изменения из других вкладок приходят сразу" : "Нет связи — переподключаюсь…"}>
              <Badge color={online ? "teal" : "red"} variant="dot" visibleFrom="sm">{online ? "онлайн" : "нет связи"}</Badge>
            </Tooltip>
          </Group>
          <Group visibleFrom="sm" style={{ flex: 1, maxWidth: 620 }} mx="md"><QuickAdd /></Group>
          <Group gap="xs" wrap="nowrap">
            <Tooltip label={<>Новая заметка <Kbd size="xs">N</Kbd></>}>
              <Button leftSection={<Icon name="plus" size={16} />} onClick={() => openEditor({ kind: "new" })} visibleFrom="sm">
                Новая заметка
              </Button>
            </Tooltip>
            <ActionIcon size="lg" hiddenFrom="sm" onClick={() => openEditor({ kind: "new" })} aria-label="Новая заметка">
              <Icon name="plus" />
            </ActionIcon>
            <Popover width={320} position="bottom-end" shadow="md">
              <Popover.Target>
                <Indicator disabled={!recent.data?.some((n) => !n.shown_at)} size={8} offset={4}>
                  <ActionIcon variant="default" size="lg" aria-label="Уведомления">
                    <Icon name="bell" />
                  </ActionIcon>
                </Indicator>
              </Popover.Target>
              <Popover.Dropdown>
                <Text fw={700} size="sm" mb="xs">Уведомления</Text>
                <ScrollArea.Autosize mah={360}>
                  <Stack gap="xs">
                    {(recent.data ?? []).length === 0 && <Text size="sm" c="dimmed">Пока пусто. Здесь появятся сработавшие напоминания.</Text>}
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
            <Tooltip label={user.email}>
              <ActionIcon variant="default" size="lg" onClick={logout} aria-label="Выйти" visibleFrom="sm">
                <Icon name="logout" />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="sm">
        <Stack gap="md">
          {groups.map(([title, links]) => (
            <div key={title || "rest"}>
              {title && <Text size="xs" fw={700} c="dimmed" tt="uppercase" px="sm" mb={4} style={{ letterSpacing: "0.05em" }}>{title}</Text>}
              {links.map((l) => (
                <MNavLink
                  key={l.to}
                  component={NavLink}
                  to={l.to}
                  label={l.label}
                  leftSection={<Icon name={l.icon} />}
                  rightSection={l.count ? <Badge size="sm" variant={l.alert ? "filled" : "light"} color={l.alert ? "orange" : "gray"} circle={l.count < 10}>{l.count}</Badge> : null}
                  active={pathname.startsWith(l.to)}
                  onClick={close}
                  style={{ borderRadius: "var(--mantine-radius-md)" }}
                />
              ))}
            </div>
          ))}
        </Stack>
        <Stack gap={4} mt="auto" hiddenFrom="sm">
          <Text size="xs" c="dimmed" px="sm">{user.email}</Text>
          <MNavLink label="Выйти" leftSection={<Icon name="logout" />} onClick={logout} />
        </Stack>
        <Text size="xs" c="dimmed" px="sm" mt="auto" visibleFrom="sm">
          <Kbd size="xs">N</Kbd> — новая заметка
        </Text>
      </AppShell.Navbar>
      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
}

// Кнопки во всплывающем напоминании: отложить на 10 минут / час / до завтра 9:00 или сразу отметить «готово».
function ReminderActions({ n, tz }: { n: AppNotification; tz: string }) {
  const act = (path: string, body?: object) =>
    api(`/notifications/${n.id}/${path}`, { method: "POST", body }).catch((e) => notifications.show({ color: "red", message: (e as Error).message }));
  const now = DateTime.now().setZone(tz);
  const tomorrow9 = Math.round(now.plus({ days: 1 }).set({ hour: 9, minute: 0 }).diff(now, "minutes").minutes);
  return (
    <Stack gap={6}>
      <Text size="sm">{n.body}</Text>
      <Group gap={4}>
        <Text size="xs" c="dimmed">Напомнить:</Text>
        <Button size="compact-xs" variant="light" onClick={() => act("snooze", { minutes: 10 })}>через 10 мин</Button>
        <Button size="compact-xs" variant="light" onClick={() => act("snooze", { minutes: 60 })}>через час</Button>
        <Button size="compact-xs" variant="light" onClick={() => act("snooze", { minutes: tomorrow9 })}>завтра в 9</Button>
        <Button size="compact-xs" color="teal" onClick={() => act("done")}>✓ Готово</Button>
      </Group>
    </Stack>
  );
}
