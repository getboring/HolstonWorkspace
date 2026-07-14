import { Text } from "@cloudflare/kumo/components/text";

export function PoweredBy() {
  return (
    <div className="border-t border-kumo-hairline bg-kumo-base px-4 py-1.5 text-center">
      <Text variant="secondary" size="xs">
        Powered by{" "}
        <a
          href="https://developers.cloudflare.com/agents/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline text-kumo-link"
        >
          Cloudflare Agents
        </a>
      </Text>
    </div>
  );
}
