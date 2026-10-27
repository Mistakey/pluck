pub mod cpa;
pub mod error;
pub mod managed;
pub mod service;
pub mod settings_file;
pub mod store;

pub mod desktop;

pub fn run() {
    desktop::run()
}
