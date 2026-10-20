use std::{
    env,
    io::{self, Read},
    net::SocketAddr,
};
#[tokio::main]
async fn main() {
    let url = env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://norns.sqlite".into());
    let args: Vec<String> = env::args().collect();
    if args.get(1).is_some_and(|a| a == "init-admin") {
        let name = args
            .get(2)
            .expect("usage: norns init-admin USERNAME < password-file");
        let mut password = String::new();
        io::stdin()
            .read_to_string(&mut password)
            .expect("read stdin");
        if let Err(e) = norns::init_admin(&url, name, password.trim_end_matches(['\r', '\n'])).await
        {
            eprintln!("{e}");
            std::process::exit(1)
        }
        println!("Norns administrator initialized");
        return;
    }
    if args.len() > 1 {
        eprintln!("usage: norns [init-admin USERNAME]");
        std::process::exit(1)
    }
    let addr: SocketAddr = env::var("BIND_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:3000".into())
        .parse()
        .expect("BIND_ADDR");
    let origin = env::var("APP_ORIGIN").unwrap_or_else(|_| "http://127.0.0.1:3000".into());
    let secure = env::var("COOKIE_SECURE").unwrap_or_else(|_| "true".into()) != "false";
    if !secure && !addr.ip().is_loopback() {
        panic!("insecure cookies require loopback bind")
    }
    let app = norns::app(&url, &origin, secure).await;
    let listener = tokio::net::TcpListener::bind(addr).await.expect("listen");
    println!("Norns listening on {addr}");
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(async {
        let _ = tokio::signal::ctrl_c().await;
    })
    .await
    .expect("serve");
}
