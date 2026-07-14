export function PoweredBy() {
  return (
    <div className="holston-powered-by">
      <span>
        Powered by{" "}
        <a
          href="https://developers.cloudflare.com/agents/"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "inherit", textDecoration: "underline" }}
        >
          Cloudflare Agents
        </a>
      </span>
    </div>
  );
}