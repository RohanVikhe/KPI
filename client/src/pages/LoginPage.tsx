import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth.tsx";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: FormValues) => {
    setError("");
    try {
      await login(values.email, values.password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <div className="brand-mark">K</div>
          <div>
            <h1>KPI Pulse</h1>
            <p>Secure access to performance intelligence.</p>
          </div>
        </div>

        <form className="form" onSubmit={handleSubmit(onSubmit)}>
          <label className="form-field">
            <span>Email</span>
            <input type="email" placeholder="you@company.com" {...register("email")} />
            {errors.email && <span className="form-error">{errors.email.message}</span>}
          </label>

          <label className="form-field">
            <span>Password</span>
            <input type="password" placeholder="********" {...register("password")} />
            {errors.password && <span className="form-error">{errors.password.message}</span>}
          </label>

          {error && <div className="form-error">{error}</div>}

          <button className="btn btn-primary" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <div className="login-note">
          New here? Ask your manager or admin to create your account.
        </div>
      </div>
    </div>
  );
}
