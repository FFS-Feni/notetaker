import "@mantine/core/styles.css";

import { MantineProvider, Title, Text, Stack } from "@mantine/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function App() {
  return (
    <Stack p="xl">
      <Title order={2}>Notetaker</Title>
      <Text c="dimmed">Каркас фронтенда. Экраны появятся по плану в docs/PLAN.md.</Text>
    </Stack>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider defaultColorScheme="auto">
      <App />
    </MantineProvider>
  </StrictMode>,
);
