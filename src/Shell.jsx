export default function Shell({ repo, children }) {
  return (
    <div className="page">
      {children}
      <footer className="footer">
        built by{" "}
        <a href="https://www.rishabhsingh.tech" target="_blank" rel="noreferrer">
          rishabh singh
        </a>
        {" · "}
        <a href={`https://github.com/singhrishabh93/${repo}`} target="_blank" rel="noreferrer">
          source
        </a>
        {" · "}
        <a href="https://www.rishabhsingh.tech/mini-apps">more mini apps</a>
      </footer>
    </div>
  );
}
