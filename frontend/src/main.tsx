import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "@mantine/notifications/styles.css";
import "./app.css";

import { Center, Loader, MantineProvider } from "@mantine/core";
import { DatesProvider } from "@mantine/dates";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import "dayjs/locale/ru";
import { lazy, StrictMode, Suspense, useState } from "react";
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
const MatrixPage = lazy(() => import("./pages/MatrixPage").then((m) => ({ default: m.MatrixPage })));
const TrashPage = lazy(() => import("./pages/TrashPage").then((m) => ({ default: m.TrashPage })));
const TagsPage = lazy(() => import("./pages/TagsPage").then((m) => ({ default: m.TagsPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2, refetchOnWindowFocus: false } },
});

function App() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<User>("/me") });
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  if (me.isPending)
    return (
      <Center mih="100vh">
        <Loader />
      </Center>
    );
  if (!me.data) return <Login />;
  return (
    <AppContext.Provider value={{ user: me.data, openEditor: setEditor }}>
      <Layout>
        <Suspense fallback={<Center mih={200}><Loader /></Center>}>
        <Routes>
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/notes" element={<NotesPage />} />
          <Route path="/upcoming" element={<UpcomingPage />} />
          <Route path="/matrix" element={<MatrixPage />} />
          <Route path="/trash" element={<TrashPage />} />
          <Route path="/tags" element={<TagsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/calendar" replace />} />
        </Routes>
        </Suspense>
      </Layout>
      {editor && <NoteEditor key={JSON.stringify(editor)} target={editor} onClose={() => setEditor(null)} />}
    </AppContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider defaultColorScheme="auto">
      <DatesProvider settings={{ locale: "ru", firstDayOfWeek: 1 }}>
        <Notifications position="top-right" />
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </DatesProvider>
    </MantineProvider>
  </StrictMode>,
);
