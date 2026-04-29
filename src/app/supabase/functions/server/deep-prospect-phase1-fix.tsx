// ══════════════════════════════════════════════════════════════
// PHASE 1 FIX: Apollo.io Primary + SerpAPI Fallback
// Replace lines 1040-1180 in deep-prospect.tsx with this code
// ══════════════════════════════════════════════════════════════

// START REPLACEMENT (line 1040)
          // ══════════════════════════════════════════════════════════════
          // PHASE 1: Apollo.io People Search (Primary) + SerpAPI Fallback
          // ══════════════════════════════════════════════════════════════
          send("phase", { phase: 1, name: "Discovering professional profiles", status: "searching" });

          console.log(`[DEEP PROSPECT] ═══ PHASE 1 START ═══`);
          console.log(`[DEEP PROSPECT] External needed: ${externalNeeded}`);
          console.log(`[DEEP PROSPECT] Search parameters:`);
          console.log(`  - person_titles: ${person_titles?.join(', ') || 'none'}`);
          console.log(`  - organization_locations: ${organization_locations?.join(', ') || 'none'}`);
          console.log(`  - person_seniorities: ${person_seniorities?.join(', ') || 'none'}`);
          console.log(`  - q_keywords: ${q_keywords || 'none'}`);
          console.log(`  - organization_industries: ${organization_industries?.join(', ') || 'none'}`);

          const allParsed: ParsedPerson[] = [];
          let apolloSuccess = false;

          // ═══ TRY APOLLO.IO FIRST (Best quality, highest signal) ═══
          const APOLLO_KEY = Deno.env.get("APOLLO_API_KEY");
          if (APOLLO_KEY) {
            try {
              console.log(`[DEEP PROSPECT] Phase 1A: Trying Apollo.io people search...`);
              
              // Build Apollo search body - Apollo uses arrays for all filters
              const apolloBody: Record<string, any> = {
                page: 1,
                per_page: Math.min(externalNeeded, 100),
              };
              
              if (person_titles?.length) apolloBody.person_titles = person_titles;
              if (person_seniorities?.length) apolloBody.person_seniorities = person_seniorities;
              if (organization_locations?.length) apolloBody.person_locations = organization_locations;
              if (organization_industries?.length) apolloBody.organization_industry_tag_ids = organization_industries;
              if (q_keywords) apolloBody.q_keywords = q_keywords;

              console.log(`[DEEP PROSPECT] Apollo.io request:`, JSON.stringify(apolloBody));

              const apolloResponse = await fetch(`https://api.apollo.io/api/v1/mixed_people/search`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Api-Key": APOLLO_KEY,
                },
                body: JSON.stringify(apolloBody),
                signal: AbortSignal.timeout(30000),
              });

              if (apolloResponse.ok) {
                const apolloData = await apolloResponse.json();
                const apolloPeople = apolloData.people || apolloData.breadcrumbs || [];
                
                console.log(`[DEEP PROSPECT] Apollo.io returned ${apolloPeople.length} people`);
                
                if (apolloPeople.length > 0) {
                  // Transform Apollo results to ParsedPerson format
                  for (const p of apolloPeople) {
                    const org = p.organization || p.employment_history?.[0]?.organization || {};
                    const name = p.name || `${p.first_name || ""} ${p.last_name || ""}`.trim();
                    
                    if (!name || name.length < 3) continue; // Skip invalid names
                    
                    allParsed.push({
                      name: toTitleCase(name),
                      first_name: toTitleCase(p.first_name || ""),
                      last_name: toTitleCase(p.last_name || ""),
                      title: p.title || p.headline || "",
                      company: toTitleCase(org.name || ""),
                      linkedin_url: p.linkedin_url || "",
                      location: `${p.city || ""}${p.city && p.state ? ", " : ""}${p.state || ""}${(p.city || p.state) && p.country ? ", " : ""}${p.country || ""}`.trim(),
                      snippet: org.short_description || "",
                      source_url: p.linkedin_url || "",
                      source_type: "apollo",
                      seniority: p.seniority || inferSeniority(p.title || ""),
                      industry: org.industry || "",
                      estimated_num_employees: org.estimated_num_employees || 0,
                    });
                  }
                  
                  apolloSuccess = true;
                  console.log(`[DEEP PROSPECT] Apollo.io success: ${allParsed.length} leads extracted`);
                  send("progress", { fetched: allParsed.length, total: externalNeeded, phase: "apollo" });
                }
              } else {
                const errText = await apolloResponse.text().catch(() => "");
                console.warn(`[DEEP PROSPECT] Apollo.io search failed: ${apolloResponse.status} ${apolloResponse.statusText}${errText ? `: ${errText}` : ""}`);
              }
            } catch (apolloErr: any) {
              console.warn(`[DEEP PROSPECT] Apollo.io search error: ${apolloErr.message}`);
            }
          } else {
            console.log(`[DEEP PROSPECT] APOLLO_API_KEY not configured, skipping Apollo.io search`);
          }

          // ═══ FALLBACK TO SERPAPI IF APOLLO FAILED OR RETURNED TOO FEW RESULTS ═══
          const seenNames = new Set<string>(allParsed.map(p => p.name.toLowerCase()));
          
          // Only use SerpAPI if Apollo returned less than 50% of what we need
          if (!apolloSuccess || allParsed.length < Math.max(externalNeeded * 0.5, 5)) {
            console.log(`[DEEP PROSPECT] Phase 1B: Apollo returned insufficient results (${allParsed.length}/${externalNeeded}), trying SerpAPI fallback...`);
            
            // Use preferred_industries as SerpAPI query hints
            const serpIndustryHints = organization_industries?.length
              ? organization_industries
              : (preferred_industries?.length ? preferred_industries : undefined);
            if (serpIndustryHints && !organization_industries?.length) {
              console.log(`[DEEP PROSPECT] Using preferred_industries as SerpAPI hints: [${serpIndustryHints.join(', ')}]`);
            }

            const serpQueries = buildSerpQueries({
              person_titles,
              organization_locations,
              person_seniorities,
              q_keywords,
              organization_industries: serpIndustryHints,
              max_results: Math.max(externalNeeded - allParsed.length, 10),
            });

            console.log(`[DEEP PROSPECT] Generated ${serpQueries.length} SerpAPI fallback queries`);

            const parseResults = (results: any[]): number => {
              let parsedCount = 0;
              for (const result of results) {
                const parsed = parseSearchResult(result);
                if (!parsed) continue;
                if (seenNames.has(parsed.name.toLowerCase())) continue;
                if (person_seniorities?.length && !person_seniorities.includes(parsed.seniority) && parsed.seniority !== "unknown") continue;
                seenNames.add(parsed.name.toLowerCase());
                allParsed.push(parsed);
                parsedCount++;
              }
              return parsedCount;
            };

            // Fire top 4 queries in parallel (reduced from original 6 for speed)
            const PARALLEL_CAP = Math.min(serpQueries.length, 4);
            const maxQueries = Math.min(serpQueries.length, 8); // Only try first 8 queries
            
            for (let batch = 0; batch < maxQueries; batch += PARALLEL_CAP) {
              if (isCancelled || allParsed.length >= externalNeeded) break;
              const batchQueries = serpQueries.slice(batch, batch + PARALLEL_CAP);

              const batchResults = await Promise.allSettled(
                batchQueries.map((q) => serpSearch(q, SERPAPI_KEY, 50, 0))
              );

              for (const r of batchResults) {
                if (r.status === "fulfilled" && r.value.length > 0) {
                  const parsed = parseResults(r.value);
                  console.log(`[DEEP PROSPECT] SerpAPI batch: ${r.value.length} raw → ${parsed} parsed (total: ${allParsed.length})`);
                }
              }
              send("progress", { fetched: allParsed.length, total: externalNeeded, phase: "crawl" });

              if (batch + PARALLEL_CAP < maxQueries && !isCancelled && allParsed.length < externalNeeded) {
                await sleep(500);
              }
            }

            console.log(`[DEEP PROSPECT] SerpAPI fallback complete: ${allParsed.length} total people`);
          }

          send("phase", { phase: 1, name: "Discovering professional profiles", status: "complete", total_available: allParsed.length });

          if (allParsed.length === 0) {
            console.log(`[DEEP PROSPECT] Phase 1 complete: 0 leads found (Apollo + SerpAPI both failed)`);
            send("complete", { people: poolLeads as any, stats: buildStats(poolLeads as any), existing_emails: [], from_pool: poolLeads.length, deep_prospect: true, total_available: 0, requested: max_results });
            clearInterval(heartbeat);
            safeClose();
            return;
          }

          // Trim to what we need
          const enrichmentCap = Math.min(allParsed.length, Math.max(externalNeeded * 2, 50));
          const trimmed = allParsed.slice(0, enrichmentCap);
          console.log(`[DEEP PROSPECT] Phase 1 complete: ${allParsed.length} unique people found, enriching top ${trimmed.length}`);
// END REPLACEMENT (line 1180)
