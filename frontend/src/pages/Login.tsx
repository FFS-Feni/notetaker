import { Alert, Anchor, Button, Center, Paper, PasswordInput, Stack, Text, TextInput, Title } from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";

export function Login() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e?: React.FormEvent, creds = { email, password }) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      await api(`/auth/${mode === "login" ? "login" : "register"}`, { method: "POST", body: { ...creds, timezone } });
      await qc.invalidateQueries({ queryKey: ["me"] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Center mih="100vh" p="md">
      <Paper withBorder p="xl" radius="md" w={380}>
        <form onSubmit={submit}>
          <Stack>
            <Title order={3}>{mode === "login" ? "Вход в Notetaker" : "Регистрация"}</Title>
            {error && <Alert color="red">{error}</Alert>}
            <TextInput label="Почта" type="email" required value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
            <PasswordInput label="Пароль" description={mode === "register" ? "Не короче 6 символов" : undefined} required value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
            <Button type="submit" loading={busy}>{mode === "login" ? "Войти" : "Зарегистрироваться"}</Button>
            {mode === "login" && (
              <Button variant="light" onClick={() => submit(undefined, { email: "demo@example.com", password: "demo12345" })}>
                Войти в демо-аккаунт
              </Button>
            )}
            <Text size="sm" c="dimmed">
              {mode === "login" ? "Нет аккаунта? " : "Уже есть аккаунт? "}
              <Anchor component="button" type="button" onClick={() => setMode(mode === "login" ? "register" : "login")}>
                {mode === "login" ? "Регистрация" : "Войти"}
              </Anchor>
            </Text>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}
