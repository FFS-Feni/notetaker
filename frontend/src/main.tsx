import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "@mantine/notifications/styles.css";
import "./app.css";

import { Center, createTheme, Loader, MantineProvider, useMantineColorScheme } from "@mantine/core";
import { DatesProvider } from "@mantine/dates";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import "dayjs/locale/ru";
import { lazy, StrictMode, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { api, ApiError, type User } from "./api";
import { Layout } from "./components/Layout";
import { NoteEditor } from "./components/NoteEditor";
import { AppContext, type EditorTarget } from "./context";
import { Login } from "./pages/Login";

// Экраны грузятся по требованию: тяжёлый календарь не тормозит открытие списка или «Ближайшего».
const CalendarPage = lazy(() => import("./pages/CalendarPage").then((m) => ({ default: m.CalendarPage })));
const NotesPage = lazy(() => import("./pages/NotesPage").then((m) => ({ default: m.NotesPage })));
const UpcomingPage = lazy(() => import("./pages/UpcomingPage").then((m) => ({ default: m.UpcomingPage })));
const TasksPage = lazy(() => import("./pages/TasksPage").then((m) => ({ default: m.TasksPage })));
const TrashPage = lazy(() => import("./pages/TrashPage").then((m) => ({ default: m.TrashPage })));
const TagsPage = lazy(() => import("./pages/TagsPage").then((m) => ({ default: m.TagsPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));

// Тема: спокойный индиго, скруглённые углы, плотная типографика заголовков.
const theme = createTheme({
  primaryColor: "indigo",
  defaultRadius: "md",
  headings: { fontWeight: "750" },
  cursorType: "pointer",
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2, refetchOnWindowFocus: false } },
});

// «matrix» — старое имя доски; без приоритетов доски нет — открываем «Ближайшее».
const startPage = (p: User["prefs"]) => {
  const page = p.start_page === "matrix" ? "tasks" : p.start_page;
  return page === "tasks" && !p.priorities ? "upcoming" : page;
};

function App() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<User>("/me") });
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const { setColorScheme } = useMantineColorScheme();
  const theme = me.data?.prefs.theme;
  useEffect(() => {
    if (theme) setColorScheme(theme); // тема из настроек — одинаковая на всех устройствах
  }, [theme, setColorScheme]);
  if (me.isPending)
    return (
      <Center mih="100vh">
        <Loader />
      </Center>
    );
  if (!me.data) return <Login />;
  const prefs = me.data.prefs;
  return (
    <AppContext.Provider value={{ user: me.data, openEditor: setEditor }}>
      <DatesProvider settings={{ locale: "ru", firstDayOfWeek: prefs.week_start }}>
      <Layout>
        <Suspense fallback={<Center mih={200}><Loader /></Center>}>
        <Routes>
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/notes" element={<NotesPage />} />
          <Route path="/upcoming" element={<UpcomingPage />} />
          {prefs.priorities && <Route path="/tasks" element={<TasksPage />} />}
          <Route path="/matrix" element={<Navigate to="/tasks" replace />} />
          <Route path="/trash" element={<TrashPage />} />
          <Route path="/tags" element={<TagsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to={`/${startPage(prefs)}`} replace />} />
        </Routes>
        </Suspense>
      </Layout>
      {editor && <NoteEditor key={JSON.stringify(editor)} target={editor} onClose={() => setEditor(null)} />}
      </DatesProvider>
    </AppContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <Notifications position="top-right" />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
);
