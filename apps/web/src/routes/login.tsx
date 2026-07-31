import { Button } from "@adversary/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@adversary/ui/components/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@adversary/ui/components/field";
import { Input } from "@adversary/ui/components/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@adversary/ui/components/tabs";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { useLoginMutation, useRegisterMutation } from "@/hooks/use-auth";

export const Route = createFileRoute("/login")({
  component: LoginRoute,
});

function LoginRoute() {
  const navigate = useNavigate();
  const login = useLoginMutation();
  const register = useRegisterMutation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();

  function submit(mode: "login" | "register") {
    setError(undefined);
    const mutation = mode === "login" ? login : register;
    mutation.mutate(
      { email, password },
      {
        onSuccess: () => {
          toast.success(mode === "login" ? "Logged in." : "Account created.");
          void navigate({ to: "/operations" });
        },
        onError: (cause) => {
          setError(cause instanceof Error ? cause.message : "Authentication failed.");
        },
      },
    );
  }

  const pending = login.isPending || register.isPending;

  return (
    <main className="grid min-h-full place-items-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Operator access</CardTitle>
          <CardDescription>Sign in to use a session-authenticated API.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="login">
            <TabsList className="w-full">
              <TabsTrigger value="login">Login</TabsTrigger>
              <TabsTrigger value="register">Register</TabsTrigger>
            </TabsList>
            {(["login", "register"] as const).map((mode) => (
              <TabsContent key={mode} value={mode} className="pt-4">
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    submit(mode);
                  }}
                >
                  <FieldGroup>
                    <Field data-invalid={Boolean(error) || undefined}>
                      <FieldLabel htmlFor={`${mode}-email`}>Email</FieldLabel>
                      <Input
                        id={`${mode}-email`}
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        required
                      />
                    </Field>
                    <Field data-invalid={Boolean(error) || undefined}>
                      <FieldLabel htmlFor={`${mode}-password`}>Password</FieldLabel>
                      <Input
                        id={`${mode}-password`}
                        type="password"
                        autoComplete={mode === "login" ? "current-password" : "new-password"}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        required
                      />
                      <FieldError>{error}</FieldError>
                    </Field>
                    <Button type="submit" disabled={pending}>
                      {pending ? "Working…" : mode === "login" ? "Login" : "Create account"}
                    </Button>
                  </FieldGroup>
                </form>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </main>
  );
}
