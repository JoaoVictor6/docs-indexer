use pulldown_cmark::{Event, Parser, Tag, TagEnd};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Chunk {
    pub text: String,
    pub heading: Option<String>,
    pub heading_path: Vec<String>,
    pub chunk_index: usize,
}

const MAX_CHUNK_SIZE: usize = 1500;

pub fn chunk_document(content: &str) -> Vec<Chunk> {
    let sections = split_by_headings(content);
    let mut chunks: Vec<Chunk> = Vec::new();
    let mut heading_stack: Vec<(usize, String)> = Vec::new();

    for (heading_level, heading_text, section_text) in sections {
        if !heading_text.is_empty() {
            while !heading_stack.is_empty()
                && heading_stack.last().map(|(l, _)| *l).unwrap() >= heading_level
            {
                heading_stack.pop();
            }
            heading_stack.push((heading_level, heading_text.clone()));
        }

        let body = section_text.trim().to_string();
        if body.is_empty() {
            continue;
        }

        let current_heading = heading_stack.last().map(|(_, t)| t.clone());

        if body.len() <= MAX_CHUNK_SIZE {
            chunks.push(Chunk {
                text: body,
                heading: current_heading,
                heading_path: heading_stack.iter().map(|(_, t)| t.clone()).collect(),
                chunk_index: chunks.len(),
            });
        } else {
            let subchunks = split_by_paragraphs(&body, MAX_CHUNK_SIZE);
            for text in subchunks {
                let heading_path: Vec<String> =
                    heading_stack.iter().map(|(_, t)| t.clone()).collect();
                chunks.push(Chunk {
                    text,
                    heading: current_heading.clone(),
                    heading_path,
                    chunk_index: chunks.len(),
                });
            }
        }
    }

    chunks
}

fn split_by_headings(content: &str) -> Vec<(usize, String, String)> {
    let parser = Parser::new(content);
    let mut sections: Vec<(usize, String, String)> = Vec::new();
    let mut current_heading_text = String::new();
    let mut current_text = String::new();
    let mut in_heading = false;
    let mut current_level = 1usize;
    let mut first_section = true;

    for event in parser {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                in_heading = true;

                if !first_section {
                    sections.push((
                        current_level,
                        current_heading_text.clone(),
                        current_text.clone(),
                    ));
                    current_text.clear();
                }
                first_section = false;
                current_heading_text.clear();
                current_level = level as usize;
            }
            Event::End(TagEnd::Heading(..)) => {
                in_heading = false;
            }
            Event::Start(Tag::Paragraph) => {
                if !in_heading && !current_text.is_empty() {
                    current_text.push_str("\n\n");
                }
            }
            Event::Text(text) | Event::Code(text) => {
                if in_heading {
                    current_heading_text.push_str(&text);
                } else {
                    current_text.push_str(&text);
                }
            }
            Event::SoftBreak => {
                if !in_heading {
                    current_text.push(' ');
                }
            }
            Event::HardBreak => {
                if !in_heading {
                    current_text.push('\n');
                }
            }
            _ => {}
        }
    }

    if !current_text.trim().is_empty() {
        sections.push((current_level, current_heading_text, current_text));
    }

    sections
}

fn split_by_paragraphs(text: &str, max_size: usize) -> Vec<String> {
    let paragraphs: Vec<&str> = text.split("\n\n").collect();
    let mut chunks: Vec<String> = Vec::new();
    let mut current = String::new();

    for para in paragraphs {
        let para = para.trim();
        if para.is_empty() {
            continue;
        }

        if !current.is_empty() && current.len() + para.len() + 2 > max_size {
            chunks.push(current);
            current = String::new();
        }

        if !current.is_empty() {
            current.push_str("\n\n");
        }
        current.push_str(para);
    }

    if !current.is_empty() {
        chunks.push(current);
    }

    chunks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chunk_simple_document() {
        let content = "\
## Introduction
This is the introduction text.

## Setup
First, install the CLI. Then configure the database.

### Configuration
Set up the .env file with your credentials.";

        let chunks = chunk_document(content);
        assert_eq!(chunks.len(), 3);

        assert_eq!(chunks[0].heading.as_deref(), Some("Introduction"));
        assert_eq!(chunks[0].heading_path, vec!["Introduction"]);
        assert!(chunks[0].text.contains("introduction text"));

        assert_eq!(chunks[1].heading.as_deref(), Some("Setup"));
        assert_eq!(chunks[1].heading_path, vec!["Setup"]);

        assert_eq!(chunks[2].heading.as_deref(), Some("Configuration"));
        assert_eq!(chunks[2].heading_path, vec!["Setup", "Configuration"]);
    }

    #[test]
    fn test_chunk_empty_document() {
        let chunks = chunk_document("");
        assert!(chunks.is_empty());
    }

    #[test]
    fn test_chunk_no_headings() {
        let content = "This is a plain document with no headings.\n\nIt has multiple paragraphs.";
        let chunks = chunk_document(content);
        assert_eq!(chunks.len(), 1);
        assert!(chunks[0].heading.is_none());
        assert!(chunks[0].heading_path.is_empty());
    }

    #[test]
    fn test_chunk_skips_empty_sections() {
        let content = "\
## Section A
Content A.

## Section B

## Section C
Content C.";
        let chunks = chunk_document(content);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].heading.as_deref(), Some("Section A"));
        assert_eq!(chunks[1].heading.as_deref(), Some("Section C"));
    }

    #[test]
    fn test_chunk_with_h1_resets_heading_path() {
        let content = "\
# Architecture

## Overview
The system has three layers.

## Details
Each layer handles a specific concern.";
        let chunks = chunk_document(content);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].heading_path, vec!["Architecture", "Overview"]);
        assert_eq!(chunks[1].heading_path, vec!["Architecture", "Details"]);
    }

    #[test]
    fn test_chunk_large_section_splits() {
        let mut content = String::from("## Large Section\n");
        for i in 0..200 {
            content.push_str(&format!(
                "Paragraph {} with enough text to fill space in the chunk buffer.\n\n",
                i
            ));
        }
        let chunks = chunk_document(&content);
        assert!(chunks.len() > 1, "large section should split into multiple chunks");
        for chunk in &chunks {
            assert_eq!(chunk.heading.as_deref(), Some("Large Section"));
        }
    }

    #[test]
    fn test_chunk_indexes_are_sequential() {
        let content = "\
## A
Content A.

## B
Content B.

## C
Content C.";
        let chunks = chunk_document(content);
        for (i, chunk) in chunks.iter().enumerate() {
            assert_eq!(chunk.chunk_index, i);
        }
    }
}